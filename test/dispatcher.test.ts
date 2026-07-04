import { describe, expect, it } from "vitest";
import type { AfterEvent } from "../src/hooks/contract.ts";
import type { DeliveryEvent } from "../src/delivery-sink.ts";
import type { Delivery, DeliveryAttempt } from "../src/schema.ts";
import { verify } from "../src/signing.ts";
import { createMemoryStorage } from "../src/storage/memory.ts";
import { createDispatcher } from "../src/dispatcher.ts";
import { createWebhooksCore } from "../src/core.ts";
import {
  createClock,
  failWith,
  fakeFetch,
  ok,
  seedBasics,
  setupWebhooks,
  withoutQueueCapability,
  type SetupOptions,
} from "./fixtures.ts";

async function seeded(options: SetupOptions = {}) {
  const setup = setupWebhooks(options);
  const { endpoint } = await seedBasics(setup.core);
  return { ...setup, endpoint };
}

async function publishOne(core: Awaited<ReturnType<typeof seeded>>["core"]) {
  const { message, deliveries } = await core.publish("acme", {
    eventType: "invoice.paid",
    payload: { invoiceId: "inv_1" },
  });
  return { message, delivery: deliveries[0] as Delivery };
}

describe("dispatcher happy path", () => {
  it("delivers a signed, verifiable, Standard Webhooks-compliant request", async () => {
    const { fetch, requests } = fakeFetch(() => ok());
    const { core, dispatcher, clock } = await seeded({ dispatcher: { fetch } });
    const { message, delivery } = await publishOne(core);

    expect(await dispatcher.tick()).toBe(1);

    // The wire contract.
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.headers["webhook-id"]).toBe(message.id); // message id, NOT delivery id
    expect(request.headers["content-type"]).toBe("application/json");
    expect(request.headers["user-agent"]).toMatch(/^xtandard-webhooks\//);
    expect(request.body).toBe(message.envelope);
    const envelope = JSON.parse(request.body);
    expect(envelope.type).toBe("invoice.paid");
    expect(envelope.data).toEqual({ invoiceId: "inv_1" });

    // The signature verifies with the endpoint's secret.
    const secrets = await core.getSecrets("acme", delivery.endpointId);
    await expect(
      verify({
        payload: request.body,
        headers: request.headers,
        secret: secrets[0]!.secret,
        now: Math.floor(clock.now() / 1000),
      }),
    ).resolves.toBeDefined();

    // State machine: succeeded, attempt recorded.
    const result = await core.getDelivery("acme", delivery.id);
    expect(result?.delivery.status).toBe("succeeded");
    expect(result?.delivery.nextAttemptAt).toBeNull();
    expect(result?.attempts).toHaveLength(1);
    expect(result?.attempts[0]).toMatchObject({
      attemptNumber: 1,
      ok: true,
      httpStatus: 200,
      trigger: "schedule",
    });

    // Nothing left to do.
    expect(await dispatcher.tick()).toBe(0);
  });

  it("merges endpoint static headers but the wire contract wins", async () => {
    const { fetch, requests } = fakeFetch(() => ok());
    const { core, dispatcher } = await seeded({ dispatcher: { fetch } });
    const endpoint = await core.createEndpoint("acme", {
      url: "https://custom.example/h",
      headers: { "x-tenant": "acme-primary" },
    });
    await core.publish("acme", { eventType: "invoice.paid", payload: 1 });
    await dispatcher.tick();
    const toCustom = requests.find((r) => r.url === endpoint.url);
    expect(toCustom?.headers["x-tenant"]).toBe("acme-primary");
    expect(toCustom?.headers["webhook-id"]).toMatch(/^msg_/);
  });
});

describe("retry schedule", () => {
  it("schedules the next attempt per the schedule with ±10% jitter", async () => {
    const { fetch } = fakeFetch(() => failWith(500));
    const { core, dispatcher, clock } = await seeded({
      dispatcher: { fetch, retrySchedule: ["0s", "10s", "20s"] },
    });
    const { delivery } = await publishOne(core);

    await dispatcher.tick();
    const after1 = (await core.getDelivery("acme", delivery.id))!.delivery;
    expect(after1.status).toBe("pending");
    expect(after1.attemptCount).toBe(1);
    const delay1 = Date.parse(after1.nextAttemptAt!) - clock.now();
    expect(delay1).toBeGreaterThanOrEqual(9_000);
    expect(delay1).toBeLessThanOrEqual(11_000);

    // Not due yet — the tick does nothing.
    expect(await dispatcher.tick()).toBe(0);

    clock.advance(11_001);
    await dispatcher.tick();
    const after2 = (await core.getDelivery("acme", delivery.id))!.delivery;
    expect(after2.attemptCount).toBe(2);
    const delay2 = Date.parse(after2.nextAttemptAt!) - clock.now();
    expect(delay2).toBeGreaterThanOrEqual(18_000);
    expect(delay2).toBeLessThanOrEqual(22_000);
  });

  it("dead-letters after exhausting the schedule and fires delivery.exhausted", async () => {
    const events: AfterEvent[] = [];
    const { fetch, requests } = fakeFetch(() => failWith(503, "unavailable"));
    const { core, dispatcher } = await seeded({
      dispatcher: { fetch, retrySchedule: ["0s", "0s", "0s"] },
      hooks: { after: (e) => void events.push(e) },
    });
    const { delivery } = await publishOne(core);

    await dispatcher.tick();
    await dispatcher.tick();
    await dispatcher.tick();

    const result = (await core.getDelivery("acme", delivery.id))!;
    expect(result.delivery.status).toBe("failed");
    expect(result.delivery.attemptCount).toBe(3);
    expect(result.delivery.nextAttemptAt).toBeNull();
    expect(requests).toHaveLength(3);
    expect(result.attempts.map((a) => a.httpStatus)).toEqual([503, 503, 503]);

    const exhausted = events.filter((e) => e.type === "delivery.exhausted");
    expect(exhausted).toHaveLength(1);
    const payload = exhausted[0] as Extract<AfterEvent, { type: "delivery.exhausted" }>;
    expect(payload.delivery.id).toBe(delivery.id);
    expect(payload.attempts).toHaveLength(3);

    // Dead-lettered: nothing more happens.
    expect(await dispatcher.tick()).toBe(0);
  });

  it("fires delivery.succeeded only on the terminal transition, not per retry", async () => {
    const events: AfterEvent[] = [];
    let calls = 0;
    const { fetch } = fakeFetch(() => (++calls < 3 ? failWith(500) : ok()));
    const { core, dispatcher } = await seeded({
      dispatcher: { fetch },
      hooks: { after: (e) => void events.push(e) },
    });
    await publishOne(core);
    await dispatcher.tick();
    await dispatcher.tick();
    await dispatcher.tick();
    expect(events.filter((e) => e.type === "delivery.succeeded")).toHaveLength(1);
    expect(events.filter((e) => e.type === "delivery.exhausted")).toHaveLength(0);
  });

  it("truncates stored response bodies", async () => {
    const { fetch } = fakeFetch(() => failWith(500, "x".repeat(10_000)));
    const { core, dispatcher } = await seeded({
      dispatcher: { fetch, responseBodyLimit: 100, retrySchedule: ["0s"] },
    });
    const { delivery } = await publishOne(core);
    await dispatcher.tick();
    const { attempts } = (await core.getDelivery("acme", delivery.id))!;
    expect(attempts[0]?.responseBody?.length).toBe(100);
  });

  it("records network errors (rejecting fetch) as failed attempts", async () => {
    const { fetch } = fakeFetch(() => {
      throw new Error("ECONNREFUSED");
    });
    const { core, dispatcher } = await seeded({ dispatcher: { fetch, retrySchedule: ["0s"] } });
    const { delivery } = await publishOne(core);
    await dispatcher.tick();
    const { delivery: after, attempts } = (await core.getDelivery("acme", delivery.id))!;
    expect(after.status).toBe("failed");
    expect(attempts[0]?.ok).toBe(false);
    expect(attempts[0]?.httpStatus).toBeUndefined();
    expect(attempts[0]?.error).toContain("ECONNREFUSED");
  });
});

describe("endpoint edge cases", () => {
  it("holds deliveries for disabled endpoints and resumes on enable", async () => {
    const { fetch, requests } = fakeFetch(() => ok());
    const { core, dispatcher, clock, endpoint } = await seeded({
      dispatcher: { fetch, leaseMs: 60_000 },
    });
    const { delivery } = await publishOne(core);
    await core.disableEndpoint("acme", endpoint.id);

    expect(await dispatcher.tick()).toBe(0); // held, no attempt
    expect(requests).toHaveLength(0);
    const held = (await core.getDelivery("acme", delivery.id))!.delivery;
    expect(held.status).toBe("pending");

    await core.enableEndpoint("acme", endpoint.id);
    clock.advance(60_001); // the hold parks it one lease window out
    expect(await dispatcher.tick()).toBe(1);
    expect((await core.getDelivery("acme", delivery.id))!.delivery.status).toBe("succeeded");
  });

  it("terminally fails deliveries whose endpoint was deleted", async () => {
    const { fetch, requests } = fakeFetch(() => ok());
    const { core, dispatcher, endpoint } = await seeded({ dispatcher: { fetch } });
    const { delivery } = await publishOne(core);
    await core.deleteEndpoint("acme", endpoint.id);

    await dispatcher.tick();
    const { delivery: after, attempts } = (await core.getDelivery("acme", delivery.id))!;
    expect(after.status).toBe("failed");
    expect(attempts[0]?.error).toContain("Endpoint no longer exists");
    expect(requests).toHaveLength(0);
  });

  it("auto-disables an endpoint failing beyond the window, and success clears the streak", async () => {
    const events: AfterEvent[] = [];
    let succeed = false;
    const { fetch } = fakeFetch(() => (succeed ? ok() : failWith(500)));
    const { core, dispatcher, clock, endpoint } = await seeded({
      dispatcher: {
        fetch,
        retrySchedule: ["0s", "0s", "0s", "0s", "0s", "0s"],
        autoDisable: { failingForDays: 5 },
      },
      hooks: { after: (e) => void events.push(e) },
    });

    // First failure stamps the streak start.
    await publishOne(core);
    await dispatcher.tick();
    const stamped = (await core.getEndpoint("acme", endpoint.id))!;
    expect(stamped.firstFailingAt).toBeDefined();

    // A success clears it.
    succeed = true;
    await dispatcher.tick();
    expect((await core.getEndpoint("acme", endpoint.id))!.firstFailingAt).toBeNull();

    // Fail, wait 6 days (streak stamped anew), fail again → auto-disable.
    succeed = false;
    await publishOne(core);
    await dispatcher.tick();
    clock.advance(6 * 86_400_000);
    await dispatcher.tick();

    const disabled = (await core.getEndpoint("acme", endpoint.id))!;
    expect(disabled.disabled).toBe(true);
    expect(disabled.disabledReason).toBe("auto");
    expect(events.some((e) => e.type === "endpoint.auto-disabled")).toBe(true);
  });

  it("autoDisable: false never disables", async () => {
    const { fetch } = fakeFetch(() => failWith(500));
    const { core, dispatcher, clock, endpoint } = await seeded({
      dispatcher: { fetch, retrySchedule: ["0s", "0s", "0s"], autoDisable: false },
    });
    await publishOne(core);
    await dispatcher.tick();
    clock.advance(30 * 86_400_000);
    await dispatcher.tick();
    expect((await core.getEndpoint("acme", endpoint.id))!.disabled).toBeUndefined();
  });
});

describe("leases and multi-instance claiming", () => {
  it("an expired lease re-exposes the delivery (crash recovery)", async () => {
    const { fetch, requests } = fakeFetch(() => ok());
    const { core, dispatcher, clock } = await seeded({
      dispatcher: { fetch, leaseMs: 60_000 },
    });
    const { delivery } = await publishOne(core);

    // Simulate a claimer that died mid-work: claim, then never record.
    const claimed = await core.claimDueDeliveries({ limit: 10, leaseMs: 60_000 });
    expect(claimed.map((d) => d.id)).toEqual([delivery.id]);
    expect(await dispatcher.tick()).toBe(0); // still leased

    clock.advance(60_001);
    expect(await dispatcher.tick()).toBe(1); // reclaimed after lease expiry
    expect(requests).toHaveLength(1);
    expect((await core.getDelivery("acme", delivery.id))!.delivery.status).toBe("succeeded");
  });

  it("two dispatchers over CAS storage never double-claim", async () => {
    const base = createMemoryStorage();
    const storage = withoutQueueCapability(base, { cas: true });
    const clock = createClock();
    const coreA = createWebhooksCore({ storage, allowInsecureUrls: true, now: clock.now });
    const coreB = createWebhooksCore({ storage, allowInsecureUrls: true, now: clock.now });
    await coreA.createApplication({ key: "acme" });
    await coreA.upsertEventType({ name: "e.t" });
    await coreA.createEndpoint("acme", { url: "https://x.example/h" });
    for (let i = 0; i < 10; i++) await coreA.publish("acme", { eventType: "e.t", payload: i });

    const [a, b] = await Promise.all([
      coreA.claimDueDeliveries({ limit: 10, leaseMs: 60_000 }),
      coreB.claimDueDeliveries({ limit: 10, leaseMs: 60_000 }),
    ]);
    const idsA = a.map((d) => d.id);
    const idsB = b.map((d) => d.id);
    expect(new Set([...idsA, ...idsB]).size).toBe(idsA.length + idsB.length); // disjoint
    expect(idsA.length + idsB.length).toBe(10); // and complete
  });

  it("the generic fallback works without CAS too (single-dispatcher mode)", async () => {
    const base = createMemoryStorage();
    const storage = withoutQueueCapability(base, { cas: false });
    const { fetch, requests } = fakeFetch(() => ok());
    const setup = setupWebhooks({ storage, dispatcher: { fetch } });
    await seedBasics(setup.core);
    await setup.core.publish("acme", { eventType: "invoice.paid", payload: 1 });
    expect(await setup.dispatcher.tick()).toBe(1);
    expect(requests).toHaveLength(1);
  });

  it("respects batchSize per tick", async () => {
    const { fetch, requests } = fakeFetch(() => ok());
    const { core, dispatcher } = await seeded({ dispatcher: { fetch, batchSize: 3 } });
    for (let i = 0; i < 7; i++) {
      await core.publish("acme", { eventType: "invoice.paid", payload: i });
    }
    expect(await dispatcher.tick()).toBe(3);
    expect(await dispatcher.tick()).toBe(3);
    expect(await dispatcher.tick()).toBe(1);
    expect(requests).toHaveLength(7);
  });

  it("caps concurrent in-flight attempts", async () => {
    let inFlight = 0;
    let peak = 0;
    const { fetch } = fakeFetch(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return ok();
    });
    const { core, dispatcher } = await seeded({
      dispatcher: { fetch, concurrency: 2, batchSize: 20 },
    });
    for (let i = 0; i < 8; i++) {
      await core.publish("acme", { eventType: "invoice.paid", payload: i });
    }
    expect(await dispatcher.tick()).toBe(8);
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe("manual replay", () => {
  it("retryDelivery re-queues a dead-letter; the attempt is trigger: manual", async () => {
    let fail = true;
    const { fetch } = fakeFetch(() => (fail ? failWith(500) : ok()));
    const { core, dispatcher } = await seeded({ dispatcher: { fetch, retrySchedule: ["0s"] } });
    const { delivery } = await publishOne(core);
    await dispatcher.tick();
    expect((await core.getDelivery("acme", delivery.id))!.delivery.status).toBe("failed");

    fail = false;
    await core.retryDelivery("acme", delivery.id);
    expect(await dispatcher.tick()).toBe(1);
    const { delivery: after, attempts } = (await core.getDelivery("acme", delivery.id))!;
    expect(after.status).toBe("succeeded");
    expect(attempts.at(-1)).toMatchObject({ trigger: "manual", ok: true, attemptNumber: 2 });
  });

  it("recoverEndpoint redrives failed deliveries since a timestamp", async () => {
    let fail = true;
    const { fetch } = fakeFetch(() => (fail ? failWith(500) : ok()));
    const { core, dispatcher, clock, endpoint } = await seeded({
      dispatcher: { fetch, retrySchedule: ["0s"] },
    });
    const early = await publishOne(core);
    clock.advance(3_600_000);
    const late = await publishOne(core);
    await dispatcher.tick();
    expect((await core.getDelivery("acme", early.delivery.id))!.delivery.status).toBe("failed");
    expect((await core.getDelivery("acme", late.delivery.id))!.delivery.status).toBe("failed");

    fail = false;
    const since = new Date(clock.now() - 60_000).toISOString(); // only the late one
    const { deliveryIds } = await core.recoverEndpoint("acme", endpoint.id, { since });
    expect(deliveryIds).toEqual([late.delivery.id]);
    await dispatcher.tick();
    expect((await core.getDelivery("acme", late.delivery.id))!.delivery.status).toBe("succeeded");
    expect((await core.getDelivery("acme", early.delivery.id))!.delivery.status).toBe("failed");
  });

  it("sendExample fires a signed one-off without persisting anything", async () => {
    const { fetch, requests } = fakeFetch(() => ok());
    const { core, endpoint, clock } = await seeded({ dispatcher: { fetch } });
    const result = await core.sendExample("acme", endpoint.id, { eventType: "invoice.paid" });
    expect(result.outcome.ok).toBe(true);
    expect(requests).toHaveLength(1);
    const secrets = await core.getSecrets("acme", endpoint.id);
    await expect(
      verify({
        payload: requests[0]!.body,
        headers: requests[0]!.headers,
        secret: secrets[0]!.secret,
        now: Math.floor(clock.now() / 1000),
      }),
    ).resolves.toMatchObject({ type: "invoice.paid" });
    expect(await core.listMessages("acme")).toEqual([]); // not retained
    expect(await core.listDeliveries("acme")).toEqual([]);
  });
});

describe("delivery sink", () => {
  it("emits one event per attempt with terminal flags and triggers", async () => {
    const events: DeliveryEvent[] = [];
    let calls = 0;
    const { fetch } = fakeFetch(() => (++calls < 2 ? failWith(500) : ok()));
    const { core, dispatcher, endpoint } = await seeded({
      dispatcher: { fetch },
      onDelivery: (e) => void events.push(e),
    });
    const { message, delivery } = await publishOne(core);
    await dispatcher.tick(); // fail
    await dispatcher.tick(); // succeed

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      applicationKey: "acme",
      endpointId: endpoint.id,
      messageId: message.id,
      deliveryId: delivery.id,
      eventType: "invoice.paid",
      attemptNumber: 1,
      ok: false,
      terminal: false,
      httpStatus: 500,
      trigger: "schedule",
    });
    expect(events[1]).toMatchObject({ attemptNumber: 2, ok: true, terminal: true });
  });

  it("a throwing sink never breaks delivery; errors go to onDeliveryError", async () => {
    const reported: unknown[] = [];
    const { fetch } = fakeFetch(() => ok());
    const { core, dispatcher } = await seeded({
      dispatcher: { fetch },
      onDelivery: () => {
        throw new Error("sink exploded");
      },
      onDeliveryError: (error) => void reported.push(error),
    });
    const { delivery } = await publishOne(core);
    await dispatcher.tick();
    expect((await core.getDelivery("acme", delivery.id))!.delivery.status).toBe("succeeded");
    expect(reported).toHaveLength(1);
  });
});

describe("start/stop", () => {
  it("start is idempotent, stop waits, timers never hold the process", async () => {
    const { fetch } = fakeFetch(() => ok());
    const { core, dispatcher } = await seeded({ dispatcher: { fetch, pollIntervalMs: 5 } });
    expect(dispatcher.running).toBe(false);
    dispatcher.start();
    dispatcher.start();
    expect(dispatcher.running).toBe(true);

    await publishOne(core);
    // The poller delivers without manual ticks.
    await new Promise((r) => setTimeout(r, 100));
    expect(await core.listDeliveries("acme", { status: "succeeded" })).toHaveLength(1);

    await dispatcher.stop();
    expect(dispatcher.running).toBe(false);
  });
});
