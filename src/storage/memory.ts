/**
 * In-memory storage adapter. Zero deps. Useful for tests, dev, and the demo.
 * Values are deep-cloned on write and read so callers cannot mutate stored
 * state by reference. Implements every optional capability: `watch`,
 * `compareAndSwap`, and native `claimDue` (the delivery queue).
 *
 * The driver is `@xtandard/kit/storage/memory`; `claimDue` is layered on top.
 *
 * @module
 */

import * as kit from "@xtandard/kit/storage/memory";
import type { DeliveryQueueStorage } from "./contract.ts";
import { claimDueEntries, DUE_KEY_RE } from "./due-queue.ts";
import { ROOT } from "../keys.ts";

/** Options for {@link createMemoryStorage}. */
export type MemoryStorageOptions = kit.MemoryStorageOptions;

/** The full capability set the memory adapter implements. */
export type MemoryWebhooksStorage = kit.MemoryKvStorage & DeliveryQueueStorage;

/**
 * Create an in-memory {@link WebhooksStorage} with every optional capability.
 * `watch` fires callbacks on the next microtask after a write/remove;
 * `compareAndSwap` compares structurally; `claimDue` scans the due index across
 * all applications and claims each delivery with a compare-and-swap.
 *
 * @example
 * ```ts
 * import { createMemoryStorage } from "@xtandard/webhooks/storage/memory";
 *
 * const storage = createMemoryStorage();
 * ```
 */
export function createMemoryStorage(options: MemoryStorageOptions = {}): MemoryWebhooksStorage {
  const base = kit.createMemoryStorage(options);
  return {
    ...base,
    async claimDue(input) {
      const due = (await base.getKeys(`${ROOT}/`)).filter((k) => DUE_KEY_RE.test(k));
      due.sort(); // lexicographic = chronological (13-digit zero-padded millis)
      return claimDueEntries(base, due, input);
    },
  };
}
