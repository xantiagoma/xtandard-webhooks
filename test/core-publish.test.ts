import { describe, expect, it } from "vitest";
import { IdempotencyConflictError, PayloadTooLargeError } from "../src/core.ts";
import { HookDeniedError } from "../src/hooks/contract.ts";
import { ValidationError } from "../src/validation.ts";
import { setupWebhooks } from "./fixtures.ts";

async function seeded() {
  const setup = setupWebhooks();
  await setup.core.createApplication({ key: "acme" });
  await setup.core.upsertEventType({ name: "invoice.paid" });
  await setup.core.upsertEventType({ name: "user.created" });
  return setup;
}

describe("publish", () => {
  it("persists the message with a stable serialized envelope", async () => {
    const { core } = await seeded();
    const { message, deduplicated } = await core.publish("acme", {
      eventType: "invoice.paid",
      payload: { invoiceId: "inv_1", amount: 4200 },
      timestamp: "2026-07-01T00:00:00.000Z",
    });
    expect(deduplicated).toBe(false);
    expect(message.id).toMatch(/^msg_/);
    expect(JSON.parse(message.envelope)).toEqual({
      type: "invoice.paid",
      timestamp: "2026-07-01T00:00:00.000Z",
      data: { invoiceId: "inv_1", amount: 4200 },
    });
    expect(await core.getMessage("acme", message.id)).toEqual(message);
  });

  it("fans out one pending delivery per matching enabled endpoint", async () => {
    const { core } = await seeded();
    const subscribed = await core.createEndpoint("acme", {
      url: "https://a.example/h",
      eventTypes: ["invoice.paid"],
    });
    const catchAll = await core.createEndpoint("acme", { url: "https://b.example/h" });
    const emptyList = await core.createEndpoint("acme", {
      url: "https://c.example/h",
      eventTypes: [],
    });
    const other = await core.createEndpoint("acme", {
      url: "https://d.example/h",
      eventTypes: ["user.created"],
    });
    const disabled = await core.createEndpoint("acme", {
      url: "https://e.example/h",
      disabled: true,
    });

    const { deliveries } = await core.publish("acme", {
      eventType: "invoice.paid",
      payload: {},
    });
    const endpointIds = deliveries.map((d) => d.endpointId).sort();
    expect(endpointIds).toEqual([subscribed.id, catchAll.id, emptyList.id].sort());
    expect(endpointIds).not.toContain(other.id);
    expect(endpointIds).not.toContain(disabled.id);
    for (const d of deliveries) {
      expect(d.status).toBe("pending");
      expect(d.attemptCount).toBe(0);
      expect(d.applicationKey).toBe("acme");
    }
  });

  it("publishes fine with zero matching endpoints", async () => {
    const { core } = await seeded();
    const { message, deliveries } = await core.publish("acme", {
      eventType: "invoice.paid",
      payload: 1,
    });
    expect(message).toBeDefined();
    expect(deliveries).toEqual([]);
  });

  it("requires a known event type by default, with an opt-out", async () => {
    const { core } = await seeded();
    await expect(core.publish("acme", { eventType: "no.such.type", payload: 1 })).rejects.toThrow(
      ValidationError,
    );

    const loose = setupWebhooks({ requireKnownEventTypes: false });
    await loose.core.createApplication({ key: "acme" });
    await expect(
      loose.core.publish("acme", { eventType: "no.such.type", payload: 1 }),
    ).resolves.toBeDefined();
  });

  it("enforces the payload size limit", async () => {
    const setup = setupWebhooks({ payloadLimitBytes: 64 });
    await setup.core.createApplication({ key: "acme" });
    await setup.core.upsertEventType({ name: "e.t" });
    await expect(
      setup.core.publish("acme", { eventType: "e.t", payload: { blob: "x".repeat(100) } }),
    ).rejects.toThrow(PayloadTooLargeError);
  });

  it("is idempotent: same key + same payload returns the original message", async () => {
    const { core } = await seeded();
    await core.createEndpoint("acme", { url: "https://a.example/h" });
    const first = await core.publish("acme", {
      eventType: "invoice.paid",
      payload: { n: 1 },
      idempotencyKey: "order-42",
    });
    const second = await core.publish("acme", {
      eventType: "invoice.paid",
      payload: { n: 1 },
      idempotencyKey: "order-42",
    });
    expect(second.deduplicated).toBe(true);
    expect(second.message.id).toBe(first.message.id);
    expect(second.deliveries.map((d) => d.id).sort()).toEqual(
      first.deliveries.map((d) => d.id).sort(),
    );
    // No duplicate fan-out happened.
    expect(await core.listDeliveries("acme")).toHaveLength(first.deliveries.length);
  });

  it("conflicts when the same key carries a different payload", async () => {
    const { core } = await seeded();
    await core.publish("acme", {
      eventType: "invoice.paid",
      payload: { n: 1 },
      idempotencyKey: "order-42",
    });
    await expect(
      core.publish("acme", {
        eventType: "invoice.paid",
        payload: { n: 2 },
        idempotencyKey: "order-42",
      }),
    ).rejects.toThrow(IdempotencyConflictError);
  });

  it("is vetoable via a before hook (quota gate)", async () => {
    const setup = setupWebhooks({
      hooks: {
        before: (e) => {
          if (e.type === "message.publish") throw new HookDeniedError("quota", { status: 429 });
        },
      },
    });
    await setup.core.createApplication({ key: "acme" });
    await setup.core.upsertEventType({ name: "e.t" });
    await expect(setup.core.publish("acme", { eventType: "e.t", payload: 1 })).rejects.toThrow(
      HookDeniedError,
    );
    expect(await setup.core.listMessages("acme")).toEqual([]);
  });

  it("fires message.published with the delivery ids", async () => {
    const events: unknown[] = [];
    const setup = setupWebhooks({
      hooks: {
        after: (e) => {
          if (e.type === "message.published") events.push(e);
        },
      },
    });
    await setup.core.createApplication({ key: "acme" });
    await setup.core.upsertEventType({ name: "e.t" });
    await setup.core.createEndpoint("acme", { url: "https://a.example/h" });
    const { deliveries } = await setup.core.publish("acme", { eventType: "e.t", payload: 1 });
    expect(events).toHaveLength(1);
    expect((events[0] as { deliveryIds: string[] }).deliveryIds).toEqual(
      deliveries.map((d) => d.id),
    );
  });
});

describe("message + delivery queries", () => {
  it("lists messages newest-first with filters and pagination", async () => {
    const { core, clock } = await seeded();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const { message } = await core.publish("acme", {
        eventType: i % 2 === 0 ? "invoice.paid" : "user.created",
        payload: { i },
      });
      ids.push(message.id);
      clock.advance(1000);
    }
    const all = await core.listMessages("acme");
    expect(all.map((m) => m.id)).toEqual([...ids].reverse());

    const paid = await core.listMessages("acme", { eventType: "invoice.paid" });
    expect(paid).toHaveLength(3);

    const page1 = await core.listMessages("acme", { limit: 2 });
    expect(page1.map((m) => m.id)).toEqual([ids[4], ids[3]]);
    const page2 = await core.listMessages("acme", { limit: 2, before: page1[1]?.id });
    expect(page2.map((m) => m.id)).toEqual([ids[2], ids[1]]);
  });

  it("lists deliveries filtered by endpoint, message, and status", async () => {
    const { core, clock } = await seeded();
    const a = await core.createEndpoint("acme", { url: "https://a.example/h" });
    const b = await core.createEndpoint("acme", { url: "https://b.example/h" });
    const first = await core.publish("acme", { eventType: "invoice.paid", payload: 1 });
    clock.advance(1000);
    await core.publish("acme", { eventType: "invoice.paid", payload: 2 });

    expect(await core.listDeliveries("acme")).toHaveLength(4);
    expect(await core.listDeliveries("acme", { endpointId: a.id })).toHaveLength(2);
    expect(await core.listDeliveries("acme", { messageId: first.message.id })).toHaveLength(2);
    expect(await core.listDeliveries("acme", { status: "pending" })).toHaveLength(4);
    expect(await core.listDeliveries("acme", { status: "succeeded" })).toHaveLength(0);
    expect(
      await core.listDeliveries("acme", { endpointId: b.id, messageId: first.message.id }),
    ).toHaveLength(1);
  });

  it("getDelivery returns the delivery with its attempts", async () => {
    const { core } = await seeded();
    await core.createEndpoint("acme", { url: "https://a.example/h" });
    const { deliveries } = await core.publish("acme", { eventType: "invoice.paid", payload: 1 });
    const result = await core.getDelivery("acme", deliveries[0]?.id ?? "");
    expect(result?.delivery.id).toBe(deliveries[0]?.id);
    expect(result?.attempts).toEqual([]);
    expect(await core.getDelivery("acme", "dlv_missing")).toBeNull();
  });
});
