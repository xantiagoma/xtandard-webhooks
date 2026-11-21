/**
 * Storage conformance for the webhooks drivers: the shared
 * `@xtandard/kit/storage/testing` suite (run with the `whk` key root), plus the
 * webhooks-only cases — the due-index layout and native `claimDue` semantics
 * ({@link DeliveryQueueStorage}).
 *
 * This file deliberately omits the `.test.ts` suffix so vitest does not pick it
 * up as a standalone suite — it only runs when imported by an adapter's test,
 * which injects its runner (`vitest` or `bun:test`).
 *
 * @module
 */

import {
  runConformanceCases,
  runStorageConformance,
  type ConformanceCapabilities,
  type ConformanceCase,
  type ConformanceTestApi,
  type SeedLegacy,
} from "@xtandard/kit/storage/testing";
import { dueKey, duePrefix, deliveryKey, ROOT } from "../src/keys.ts";
import type { Delivery } from "../src/schema.ts";
import {
  hasDeliveryQueue,
  type DeliveryQueueStorage,
  type WebhooksStorage,
} from "../src/storage/contract.ts";

/** A factory producing a fresh, empty storage for each test. */
export type MakeStorage = () => Promise<WebhooksStorage> | WebhooksStorage;

/** What a backend opts into. */
export interface StorageContractOptions {
  /** The injected test API (`{ describe, test, expect }` from vitest or bun:test). */
  t: ConformanceTestApi;
  /** Capabilities for the kit suite. Default: detected CAS, no watch. */
  capabilities?: ConformanceCapabilities;
  /** Run the {@link DeliveryQueueStorage.claimDue} semantics tests. */
  deliveryQueue?: boolean;
  /** Write a non-canonical stored form directly (the kit's legacy-CAS case). */
  seedLegacy?: SeedLegacy;
  /** Per-test timeout (live backends). */
  timeout?: number;
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

const NOW = 1_720_000_000_000;
const nowIso = new Date(NOW).toISOString();

const queue = (storage: WebhooksStorage): DeliveryQueueStorage => {
  if (!hasDeliveryQueue(storage)) throw new Error("expected deliveryQueue capability");
  return storage;
};

/** The webhooks key layout on any backend. */
export const dueIndexCases: ConformanceCase[] = [
  {
    name: "due-index keys sort lexicographically = chronologically",
    async run({ storage, expect }) {
      // Insert out of chronological order on purpose.
      const times = [1_720_000_300_000, 1_720_000_100_000, 1_720_000_200_000, 5];
      for (const [i, time] of times.entries()) {
        await storage.setItem(dueKey("acme", time, `dlv_${i}`), {
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
    },
  },
  {
    name: "tenants (applications) that differ only by case are isolated",
    async run({ storage, expect }) {
      await storage.setItem("whk/acme/endpoints/ep_1", { app: "acme" });
      await storage.setItem("whk/ACME/endpoints/ep_2", { app: "ACME" });
      expect(await storage.getKeys("whk/acme/")).toEqual(["whk/acme/endpoints/ep_1"]);
      expect(await storage.getKeys("whk/ACME/")).toEqual(["whk/ACME/endpoints/ep_2"]);
    },
  },
];

/** Native `claimDue` semantics (memory, redis). */
export const deliveryQueueCases: ConformanceCase[] = [
  {
    name: "claims due deliveries oldest-first and respects the limit",
    async run({ storage, expect }) {
      for (const [deliveryId, ago] of [
        ["dlv_b", 500],
        ["dlv_a", 1000],
        ["dlv_c", 100],
      ] as const) {
        await seedPendingDelivery(storage, { app: "acme", deliveryId, dueAtMillis: NOW - ago });
      }
      const claimed = await queue(storage).claimDue({ now: nowIso, limit: 2, leaseMs: 60_000 });
      expect(claimed.map((d) => d.id)).toEqual(["dlv_a", "dlv_b"]);
      for (const d of claimed) {
        expect(d.status).toBe("delivering");
        expect(Date.parse(d.leaseUntil ?? "")).toBe(NOW + 60_000);
      }
    },
  },
  {
    name: "does not claim deliveries that are not yet due",
    async run({ storage, expect }) {
      await seedPendingDelivery(storage, {
        app: "acme",
        deliveryId: "dlv_f",
        dueAtMillis: NOW + 5_000,
      });
      expect(await queue(storage).claimDue({ now: nowIso, limit: 10, leaseMs: 60_000 })).toEqual(
        [],
      );
    },
  },
  {
    name: "claims are exclusive — a second claim sees nothing until the lease expires",
    async run({ storage, expect }) {
      await seedPendingDelivery(storage, {
        app: "acme",
        deliveryId: "dlv_x",
        dueAtMillis: NOW - 1000,
      });
      const first = await queue(storage).claimDue({ now: nowIso, limit: 10, leaseMs: 60_000 });
      expect(first.map((d) => d.id)).toEqual(["dlv_x"]);
      expect(await queue(storage).claimDue({ now: nowIso, limit: 10, leaseMs: 60_000 })).toEqual(
        [],
      );
    },
  },
  {
    name: "concurrent claimers never receive the same delivery",
    async run({ storage, expect }) {
      for (let i = 0; i < 8; i++) {
        await seedPendingDelivery(storage, {
          app: "acme",
          deliveryId: `dlv_${i}`,
          dueAtMillis: NOW - 1000 + i,
        });
      }
      const claims = await Promise.all(
        Array.from({ length: 4 }, () =>
          queue(storage).claimDue({ now: nowIso, limit: 8, leaseMs: 60_000 }),
        ),
      );
      const ids = claims.flat().map((d) => d.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.sort()).toEqual(Array.from({ length: 8 }, (_, i) => `dlv_${i}`));
    },
  },
  {
    name: "lease expiry re-exposes an unfinished claim",
    async run({ storage, expect }) {
      await seedPendingDelivery(storage, {
        app: "acme",
        deliveryId: "dlv_y",
        dueAtMillis: NOW - 1000,
      });
      await queue(storage).claimDue({ now: nowIso, limit: 10, leaseMs: 60_000 });
      const afterExpiry = new Date(NOW + 60_001).toISOString();
      const reclaimed = await queue(storage).claimDue({
        now: afterExpiry,
        limit: 10,
        leaseMs: 60_000,
      });
      expect(reclaimed.map((d) => d.id)).toEqual(["dlv_y"]);
      expect(reclaimed[0]?.status).toBe("delivering");
    },
  },
  {
    name: "sweeps orphaned due entries (deleted or terminal deliveries)",
    async run({ storage, expect }) {
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
      expect(await queue(storage).claimDue({ now: nowIso, limit: 10, leaseMs: 60_000 })).toEqual(
        [],
      );
      expect(await storage.getKeys(duePrefix("acme"))).toEqual([]);
    },
  },
];

/**
 * Run the kit conformance suite (key root `whk`) against a webhooks driver,
 * plus the due-index cases and, with `deliveryQueue`, the `claimDue` cases.
 */
export function runStorageContractTests(
  name: string,
  makeStorage: MakeStorage,
  options: StorageContractOptions,
): void {
  const shared = { t: options.t, keyRoot: ROOT, timeout: options.timeout };
  runStorageConformance(name, makeStorage, {
    ...shared,
    capabilities: options.capabilities ?? { compareAndSwap: true, watch: false },
    seedLegacy: options.seedLegacy,
  });
  runConformanceCases(`webhooks key layout: ${name}`, dueIndexCases, makeStorage, shared);
  if (options.deliveryQueue) {
    runConformanceCases(
      `DeliveryQueueStorage semantics: ${name}`,
      deliveryQueueCases,
      makeStorage,
      shared,
    );
  }
}
