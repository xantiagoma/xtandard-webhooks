/**
 * In-memory storage adapter. Zero deps. Useful for tests, dev, and the demo.
 * Values are deep-cloned on write and read so callers cannot mutate stored
 * state by reference. Implements every optional capability: `watch`,
 * `compareAndSwap`, and native `claimDue` (the delivery queue).
 *
 * @module
 */

import { dueKey, deliveryKey, parseDueKey, ROOT, type DueEntry } from "../keys.ts";
import type { Delivery } from "../schema.ts";
import type {
  CompareAndSwapWebhooksStorage,
  DeliveryQueueStorage,
  StorageChangeEvent,
  WatchableWebhooksStorage,
  WebhooksStorage,
} from "./contract.ts";

/** Options for {@link createMemoryStorage}. */
export interface MemoryStorageOptions {
  /** Optional seed data (key → value). */
  initial?: Record<string, unknown>;
}

/** The full capability set the memory adapter implements. */
export type MemoryWebhooksStorage = WatchableWebhooksStorage &
  CompareAndSwapWebhooksStorage &
  DeliveryQueueStorage;

const clone = <T>(value: T): T => (value === undefined ? value : (structuredClone(value) as T));

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a as object);
  const bKeys = Object.keys(b as object);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

const DUE_KEY_RE = new RegExp(`^${ROOT}/[^/]+/due/`);

/**
 * Create an in-memory {@link WebhooksStorage} with every optional capability.
 * `watch` fires callbacks on the next microtask after a write/remove;
 * `compareAndSwap` compares deep equality; `claimDue` scans the due index
 * across all applications and claims atomically (single-threaded JS makes the
 * scan-and-write race-free in-process).
 *
 * @example
 * ```ts
 * import { createMemoryStorage } from "@xtandard/webhooks/storage/memory";
 *
 * const storage = createMemoryStorage();
 * ```
 */
export function createMemoryStorage(options: MemoryStorageOptions = {}): MemoryWebhooksStorage {
  const map = new Map<string, unknown>();
  if (options.initial) {
    for (const [k, val] of Object.entries(options.initial)) map.set(k, clone(val));
  }

  const watchers = new Set<{ prefix: string; cb: (event: StorageChangeEvent) => void }>();
  const notify = (event: StorageChangeEvent) => {
    for (const w of watchers) {
      if (event.key.startsWith(w.prefix)) queueMicrotask(() => w.cb(event));
    }
  };

  const set = (key: string, value: unknown) => {
    map.set(key, clone(value));
    notify({ type: "update", key });
  };
  const remove = (key: string) => {
    if (map.delete(key)) notify({ type: "remove", key });
  };

  return {
    async getItem<T>(key: string): Promise<T | null> {
      return map.has(key) ? clone(map.get(key) as T) : null;
    },
    async setItem<T>(key: string, value: T): Promise<void> {
      set(key, value);
    },
    async removeItem(key: string): Promise<void> {
      remove(key);
    },
    async getKeys(prefix: string): Promise<string[]> {
      const out: string[] = [];
      for (const k of map.keys()) if (k.startsWith(prefix)) out.push(k);
      return out;
    },
    async watch(prefix, cb): Promise<() => void> {
      const entry = { prefix, cb };
      watchers.add(entry);
      return () => {
        watchers.delete(entry);
      };
    },
    async compareAndSwap<T>(input: { key: string; expected: T | null; next: T }): Promise<boolean> {
      const current = map.has(input.key) ? map.get(input.key) : null;
      if (!deepEqual(current, input.expected)) return false;
      set(input.key, input.next);
      return true;
    },
    async claimDue(input): Promise<Delivery[]> {
      const nowMillis = Date.parse(input.now);
      const due: string[] = [];
      for (const k of map.keys()) if (DUE_KEY_RE.test(k)) due.push(k);
      due.sort(); // lexicographic = chronological (13-digit zero-padded millis)

      const claimed: Delivery[] = [];
      for (const key of due) {
        if (claimed.length >= input.limit) break;
        const parsed = parseDueKey(key);
        if (!parsed || parsed.dueAtMillis > nowMillis) continue;
        const entry = map.get(key) as DueEntry | undefined;
        if (!entry) continue;
        const dKey = deliveryKey(entry.app, entry.deliveryId);
        const delivery = map.get(dKey) as Delivery | undefined;
        // Orphaned or already-terminal entries are garbage — sweep them.
        if (!delivery || delivery.status === "succeeded" || delivery.status === "failed") {
          remove(key);
          continue;
        }
        // Claimable = pending, or delivering with an expired lease.
        const leaseExpired =
          delivery.status === "delivering" &&
          (!delivery.leaseUntil || Date.parse(delivery.leaseUntil) <= nowMillis);
        if (delivery.status !== "pending" && !leaseExpired) continue;

        const leaseUntil = new Date(nowMillis + input.leaseMs).toISOString();
        const next: Delivery = {
          ...delivery,
          status: "delivering",
          leaseUntil,
          updatedAt: input.now,
        };
        set(dKey, next);
        // Reposition the due entry at the lease expiry so a crashed claimer's
        // work re-surfaces automatically.
        remove(key);
        set(dueKey(entry.app, nowMillis + input.leaseMs, entry.deliveryId), entry);
        claimed.push(clone(next));
      }
      return claimed;
    },
  } satisfies WebhooksStorage & MemoryWebhooksStorage;
}
