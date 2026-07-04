/**
 * Reusable conformance suite for the {@link WebhooksStorage} contract. Storage
 * adapters can run the same battery of behavioural tests against their
 * implementation by calling {@link runStorageContractTests}.
 *
 * This file deliberately omits the `.test.ts` suffix so vitest does not pick it
 * up as a standalone suite — it only runs when imported by an adapter's test.
 *
 * @module
 */

import { describe, expect, test } from "vitest";
import { dueKey, duePrefix, deliveryKey } from "../src/keys.ts";
import type { Delivery } from "../src/schema.ts";
import { hasDeliveryQueue, type WebhooksStorage } from "../src/storage/contract.ts";

/** A factory producing a fresh, empty storage for each test. */
export type MakeStorage = () => Promise<WebhooksStorage> | WebhooksStorage;

/** Optional extras a backend opts into. */
export interface StorageContractOptions {
  /** Run the {@link DeliveryQueueStorage.claimDue} semantics tests. */
  deliveryQueue?: boolean;
}

/** Seed a pending delivery + its due-index entry the way the core writes them. */
export async function seedPendingDelivery(
  storage: WebhooksStorage,
  input: { app: string; deliveryId: string; dueAtMillis: number },
): Promise<Delivery> {
  const nowIso = new Date(input.dueAtMillis).toISOString();
  const delivery: Delivery = {
    id: input.deliveryId,
    applicationKey: input.app,
    messageId: "msg_x",
    endpointId: "ep_x",
    status: "pending",
    attemptCount: 0,
    nextAttemptAt: nowIso,
    leaseUntil: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  await storage.setItem(deliveryKey(input.app, input.deliveryId), delivery);
  await storage.setItem(dueKey(input.app, input.dueAtMillis, input.deliveryId), {
    app: input.app,
    deliveryId: input.deliveryId,
  });
  return delivery;
}

/**
 * Register a `describe(name, …)` block exercising the full
 * {@link WebhooksStorage} contract: object round-trips, null-for-missing,
 * remove semantics, prefix listing, prefix isolation, due-index ordering, and
 * (opt-in) native `claimDue` semantics.
 */
export function runStorageContractTests(
  name: string,
  makeStorage: MakeStorage,
  options: StorageContractOptions = {},
): void {
  describe(`WebhooksStorage contract: ${name}`, () => {
    test("returns null for a missing key", async () => {
      const storage = await makeStorage();
      expect(await storage.getItem("whk/acme/missing")).toBeNull();
    });

    test("round-trips an object value", async () => {
      const storage = await makeStorage();
      const value = { url: "https://x.example", eventTypes: ["a", "b"], nested: { x: 1 } };
      await storage.setItem("whk/acme/endpoints/ep_1", value);
      expect(await storage.getItem("whk/acme/endpoints/ep_1")).toEqual(value);
    });

    test("round-trips primitive values", async () => {
      const storage = await makeStorage();
      await storage.setItem("whk/acme/idempotency/k", "msg_1");
      expect(await storage.getItem("whk/acme/idempotency/k")).toBe("msg_1");
    });

    test("overwrites an existing key", async () => {
      const storage = await makeStorage();
      await storage.setItem("whk/acme/k", { v: 1 });
      await storage.setItem("whk/acme/k", { v: 2 });
      expect(await storage.getItem("whk/acme/k")).toEqual({ v: 2 });
    });

    test("removeItem deletes a key", async () => {
      const storage = await makeStorage();
      await storage.setItem("whk/acme/k", { v: 1 });
      await storage.removeItem("whk/acme/k");
      expect(await storage.getItem("whk/acme/k")).toBeNull();
    });

    test("removeItem on a missing key is a no-op", async () => {
      const storage = await makeStorage();
      await expect(storage.removeItem("whk/acme/nope")).resolves.toBeUndefined();
    });

    test("getKeys returns nested keys under a prefix", async () => {
      const storage = await makeStorage();
      await storage.setItem("whk/acme/messages/msg_1", { v: 1 });
      await storage.setItem("whk/acme/messages/msg_2", { v: 2 });
      await storage.setItem("whk/acme/metadata", { key: "acme" });
      const keys = await storage.getKeys("whk/acme/");
      expect(keys.sort()).toEqual(
        ["whk/acme/messages/msg_1", "whk/acme/messages/msg_2", "whk/acme/metadata"].sort(),
      );
    });

    test("getKeys isolates by prefix", async () => {
      const storage = await makeStorage();
      await storage.setItem("whk/app1/a", { v: 1 });
      await storage.setItem("whk/app2/b", { v: 2 });
      expect(await storage.getKeys("whk/app1/")).toEqual(["whk/app1/a"]);
      expect(await storage.getKeys("whk/app2/")).toEqual(["whk/app2/b"]);
    });

    test("getKeys returns an empty array when nothing matches", async () => {
      const storage = await makeStorage();
      await storage.setItem("whk/acme/a", { v: 1 });
      expect(await storage.getKeys("whk/other/")).toEqual([]);
    });

    test("due-index keys sort lexicographically = chronologically", async () => {
      const storage = await makeStorage();
      // Insert out of chronological order on purpose.
      const times = [1_720_000_300_000, 1_720_000_100_000, 1_720_000_200_000, 5];
      for (const [i, t] of times.entries()) {
        await storage.setItem(dueKey("acme", t, `dlv_${i}`), {
          app: "acme",
          deliveryId: `dlv_${i}`,
        });
      }
      const keys = (await storage.getKeys(duePrefix("acme"))).sort();
      expect(keys).toEqual([
        dueKey("acme", 5, "dlv_3"),
        dueKey("acme", 1_720_000_100_000, "dlv_1"),
        dueKey("acme", 1_720_000_200_000, "dlv_2"),
        dueKey("acme", 1_720_000_300_000, "dlv_0"),
      ]);
    });
  });

  if (options.deliveryQueue) {
    describe(`DeliveryQueueStorage semantics: ${name}`, () => {
      const NOW = 1_720_000_000_000;
      const nowIso = new Date(NOW).toISOString();

      test("claims due deliveries oldest-first and respects the limit", async () => {
        const storage = await makeStorage();
        if (!hasDeliveryQueue(storage)) throw new Error("expected deliveryQueue capability");
        await seedPendingDelivery(storage, {
          app: "acme",
          deliveryId: "dlv_b",
          dueAtMillis: NOW - 500,
        });
        await seedPendingDelivery(storage, {
          app: "acme",
          deliveryId: "dlv_a",
          dueAtMillis: NOW - 1000,
        });
        await seedPendingDelivery(storage, {
          app: "acme",
          deliveryId: "dlv_c",
          dueAtMillis: NOW - 100,
        });

        const claimed = await storage.claimDue({ now: nowIso, limit: 2, leaseMs: 60_000 });
        expect(claimed.map((d) => d.id)).toEqual(["dlv_a", "dlv_b"]);
        for (const d of claimed) {
          expect(d.status).toBe("delivering");
          expect(Date.parse(d.leaseUntil ?? "")).toBe(NOW + 60_000);
        }
      });

      test("does not claim deliveries that are not yet due", async () => {
        const storage = await makeStorage();
        if (!hasDeliveryQueue(storage)) throw new Error("expected deliveryQueue capability");
        await seedPendingDelivery(storage, {
          app: "acme",
          deliveryId: "dlv_f",
          dueAtMillis: NOW + 5_000,
        });
        const claimed = await storage.claimDue({ now: nowIso, limit: 10, leaseMs: 60_000 });
        expect(claimed).toEqual([]);
      });

      test("claims are exclusive — a second claim sees nothing until the lease expires", async () => {
        const storage = await makeStorage();
        if (!hasDeliveryQueue(storage)) throw new Error("expected deliveryQueue capability");
        await seedPendingDelivery(storage, {
          app: "acme",
          deliveryId: "dlv_x",
          dueAtMillis: NOW - 1000,
        });

        const first = await storage.claimDue({ now: nowIso, limit: 10, leaseMs: 60_000 });
        expect(first.map((d) => d.id)).toEqual(["dlv_x"]);
        const second = await storage.claimDue({ now: nowIso, limit: 10, leaseMs: 60_000 });
        expect(second).toEqual([]);
      });

      test("lease expiry re-exposes an unfinished claim", async () => {
        const storage = await makeStorage();
        if (!hasDeliveryQueue(storage)) throw new Error("expected deliveryQueue capability");
        await seedPendingDelivery(storage, {
          app: "acme",
          deliveryId: "dlv_y",
          dueAtMillis: NOW - 1000,
        });

        await storage.claimDue({ now: nowIso, limit: 10, leaseMs: 60_000 });
        const afterExpiry = new Date(NOW + 60_001).toISOString();
        const reclaimed = await storage.claimDue({ now: afterExpiry, limit: 10, leaseMs: 60_000 });
        expect(reclaimed.map((d) => d.id)).toEqual(["dlv_y"]);
        expect(reclaimed[0]?.status).toBe("delivering");
      });

      test("sweeps orphaned due entries (deleted or terminal deliveries)", async () => {
        const storage = await makeStorage();
        if (!hasDeliveryQueue(storage)) throw new Error("expected deliveryQueue capability");
        // Due entry pointing at nothing.
        await storage.setItem(dueKey("acme", NOW - 1000, "dlv_gone"), {
          app: "acme",
          deliveryId: "dlv_gone",
        });
        // Due entry pointing at a terminal delivery.
        const done = await seedPendingDelivery(storage, {
          app: "acme",
          deliveryId: "dlv_done",
          dueAtMillis: NOW - 900,
        });
        await storage.setItem(deliveryKey("acme", "dlv_done"), { ...done, status: "succeeded" });

        const claimed = await storage.claimDue({ now: nowIso, limit: 10, leaseMs: 60_000 });
        expect(claimed).toEqual([]);
        expect(await storage.getKeys(duePrefix("acme"))).toEqual([]);
      });
    });
  }
}
