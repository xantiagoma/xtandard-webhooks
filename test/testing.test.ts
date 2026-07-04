import { describe, expect, it } from "vitest";
import { createTestReceiver, createTestWebhooks, drainDeliveries } from "../src/testing.ts";

describe("createTestWebhooks + createTestReceiver", () => {
  it("delivers end-to-end over real HTTP with verified envelopes", async () => {
    const { core, dispatcher } = createTestWebhooks();
    await core.createApplication({ key: "acme" });
    await core.upsertEventType({ name: "order.shipped" });
    // Create the endpoint first to learn its secret, then point a verifying
    // receiver at it… we need the secret before the receiver exists, so create
    // the receiver after reading the endpoint's secret and update the URL.
    const endpoint = await core.createEndpoint("acme", { url: "http://127.0.0.1:9/placeholder" });
    const secret = (await core.getSecrets("acme", endpoint.id))[0]!.secret;
    const receiver = await createTestReceiver({ secret });
    await core.updateEndpoint("acme", endpoint.id, { url: receiver.url });

    await core.publish("acme", {
      eventType: "order.shipped",
      payload: { orderId: "o_1", carrier: "DHL" },
    });
    await drainDeliveries(dispatcher);

    expect(receiver.received).toHaveLength(1);
    expect(receiver.received[0]).toMatchObject({
      type: "order.shipped",
      data: { orderId: "o_1", carrier: "DHL" },
    });
    expect(receiver.requests[0]?.headers["webhook-id"]).toMatch(/^msg_/);
    await receiver.close();
  });

  it("failFirst exercises retries; webhook-id stays stable across attempts", async () => {
    const { core, dispatcher } = createTestWebhooks();
    await core.createApplication({ key: "acme" });
    await core.upsertEventType({ name: "e.t" });
    const receiver = await createTestReceiver({ failFirst: 2 });
    await core.createEndpoint("acme", { url: receiver.url });

    const { message } = await core.publish("acme", { eventType: "e.t", payload: 1 });
    await drainDeliveries(dispatcher);

    expect(receiver.requests).toHaveLength(3); // 2 failures + 1 success
    const ids = new Set(receiver.requests.map((r) => r.headers["webhook-id"]));
    expect(ids).toEqual(new Set([message.id]));

    const [delivery] = await core.listDeliveries("acme");
    expect(delivery?.status).toBe("succeeded");
    expect(delivery?.attemptCount).toBe(3);
    await receiver.close();
  });

  it("an unverifiable delivery is answered 401 (receiver with the wrong secret)", async () => {
    const { core, dispatcher } = createTestWebhooks({
      dispatcher: { retrySchedule: ["0s"] },
    });
    await core.createApplication({ key: "acme" });
    await core.upsertEventType({ name: "e.t" });
    const receiver = await createTestReceiver({
      secret: "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw", // not the endpoint's secret
    });
    await core.createEndpoint("acme", { url: receiver.url });
    await core.publish("acme", { eventType: "e.t", payload: 1 });
    await drainDeliveries(dispatcher);

    expect(receiver.received).toHaveLength(0);
    const [delivery] = await core.listDeliveries("acme");
    expect(delivery?.status).toBe("failed"); // 401 is a failed delivery
    await receiver.close();
  });

  it("createTestWebhooks honors readonly", async () => {
    const { core } = createTestWebhooks({ readonly: true });
    await expect(core.createApplication({ key: "x" })).rejects.toThrow("readonly");
  });
});
