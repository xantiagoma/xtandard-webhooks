import { describe, expect, it } from "vitest";
import type { AfterEvent } from "../src/hooks/contract.ts";
import type { AuditEntry, Message } from "../src/schema.ts";
import { setupWebhooks, type SetupOptions } from "./fixtures.ts";

async function seeded(options: SetupOptions = {}) {
  const events: AfterEvent[] = [];
  const setup = setupWebhooks({
    ...options,
    hooks: { after: (e) => void events.push(e) },
  });
  await setup.core.createApplication({ key: "acme" });
  await setup.core.upsertEventType({ name: "e.t" });
  return { ...setup, events };
}

describe("message retention", () => {
  it("keepLast prunes the oldest messages and cascades their deliveries", async () => {
    const { core, clock, events, storage } = await seeded({
      retention: { messages: { keepLast: 2 } },
    });
    await core.createEndpoint("acme", { url: "https://a.example/h" });
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const { message, deliveries } = await core.publish("acme", {
        eventType: "e.t",
        payload: { i },
        idempotencyKey: `k-${i}`,
      });
      ids.push(message.id);
      // Deliveries must be terminal for their message to be prunable.
      for (const d of deliveries) {
        await core.recordAttempt({
          delivery: d,
          outcome: {
            ok: true,
            httpStatus: 200,
            durationMs: 5,
            at: new Date(clock.now()).toISOString(),
          },
          trigger: "schedule",
          eventType: "e.t",
        });
      }
      clock.advance(60_000);
    }

    await core.prune();
    const remaining = await core.listMessages("acme");
    expect(remaining.map((m) => m.id)).toEqual([ids[3], ids[2]]);

    // Cascade: pruned messages' deliveries + attempts + indexes are gone.
    expect(await core.listDeliveries("acme")).toHaveLength(2);
    expect(await storage.getKeys(`whk/acme/by-message/${ids[0]}/`)).toEqual([]);
    expect(await storage.getKeys(`whk/acme/idempotency/k-0`)).toEqual([]);

    // Offload events carry the full pruned messages (possibly across several
    // opportunistic passes — assert the union).
    const pruned = events
      .filter(
        (e): e is Extract<AfterEvent, { type: "message.pruned" }> => e.type === "message.pruned",
      )
      .flatMap((e) => e.messages as Message[]);
    expect(pruned.map((m) => m.id).sort()).toEqual([ids[0], ids[1]].sort());
  });

  it("maxAge + keepLast is a union of keeps", async () => {
    const { core, clock } = await seeded({
      retention: { messages: { keepLast: 1, maxAge: "1h" } },
    });
    // Old message (outside both rules once time passes).
    await core.publish("acme", { eventType: "e.t", payload: "old" });
    clock.advance(2 * 3_600_000);
    // Recent messages: both within maxAge; only one within keepLast.
    await core.publish("acme", { eventType: "e.t", payload: "recent-1" });
    clock.advance(60_000);
    await core.publish("acme", { eventType: "e.t", payload: "recent-2" });

    await core.prune();
    const remaining = await core.listMessages("acme");
    // keepLast keeps recent-2; maxAge keeps recent-1 too; "old" is pruned.
    expect(remaining.map((m) => m.payload).sort()).toEqual(["recent-1", "recent-2"]);
  });

  it("never prunes a message with non-terminal deliveries", async () => {
    const { core, clock } = await seeded({ retention: { messages: { keepLast: 0 } } });
    await core.createEndpoint("acme", { url: "https://a.example/h" });
    await core.publish("acme", { eventType: "e.t", payload: 1 }); // delivery stays pending
    clock.advance(3_600_000);
    await core.prune();
    expect(await core.listMessages("acme")).toHaveLength(1);
  });

  it("no retention config = no pruning", async () => {
    const { core } = await seeded();
    for (let i = 0; i < 3; i++) await core.publish("acme", { eventType: "e.t", payload: i });
    await core.prune();
    expect(await core.listMessages("acme")).toHaveLength(3);
  });
});

describe("audit retention", () => {
  it("prunes by keepLast and emits audit.pruned with the removed entries", async () => {
    const { core, events } = await seeded({ retention: { audit: { keepLast: 2 } } });
    const e1 = await core.createEndpoint("acme", { url: "https://a.example/h" });
    await core.disableEndpoint("acme", e1.id);
    await core.enableEndpoint("acme", e1.id);
    expect(await core.listAudit("acme")).toHaveLength(4);

    await core.prune();
    const audit = await core.listAudit("acme");
    expect(audit.map((e) => e.action)).toEqual(["endpoint.enable", "endpoint.disable"]);

    const pruneEvents = events.filter((e) => e.type === "audit.pruned");
    expect(pruneEvents.length).toBeGreaterThanOrEqual(1);
    const removed = (pruneEvents[0] as { entries: AuditEntry[] }).entries;
    expect(removed.map((e) => e.action)).toEqual(["application.create", "endpoint.create"]);
  });
});
