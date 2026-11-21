/**
 * Storage contracts. The base {@link WebhooksStorage} is intentionally tiny —
 * four async methods — so users can bring their own backend. Optional
 * capabilities (watch, compare-and-swap, native delivery-queue claiming) are
 * separate interfaces that adapters may implement and the core feature-detects.
 *
 * The neutral contract lives in `@xtandard/kit/storage`; these are the
 * webhooks names for it, plus the webhooks-only {@link DeliveryQueueStorage}.
 *
 * @module
 */

import { requirePeer as kitRequirePeer } from "@xtandard/kit/storage";
import type { KvStorage } from "@xtandard/kit/storage";
import type { Delivery } from "../schema.ts";

export type {
  CompareAndSwapKvStorage as CompareAndSwapWebhooksStorage,
  KvStorage as WebhooksStorage,
  StorageChangeEvent,
  TransactionalKvStorage as TransactionalWebhooksStorage,
  WatchableKvStorage as WatchableWebhooksStorage,
} from "@xtandard/kit/storage";
export { isCompareAndSwap, isTransactional, isWatchable } from "@xtandard/kit/storage";

/**
 * Storage that can natively claim due deliveries (sorted-set / `SKIP LOCKED`
 * class backends). When present, the dispatcher delegates claiming entirely to
 * the adapter instead of scanning the generic due index.
 *
 * The claim contract: atomically transition each returned delivery to
 * `status: "delivering"` with `leaseUntil = now + leaseMs`, reposition its due
 * entry at the lease expiry (so a crashed claimer's work re-surfaces), and
 * never return the same delivery to two concurrent claimers.
 */
export interface DeliveryQueueStorage extends KvStorage {
  claimDue(input: { now: string; limit: number; leaseMs: number }): Promise<Delivery[]>;
}

/** Runtime feature-detection: does this storage implement `claimDue`? */
export function hasDeliveryQueue(storage: KvStorage): storage is DeliveryQueueStorage {
  return typeof (storage as Partial<DeliveryQueueStorage>).claimDue === "function";
}

/**
 * Helper for adapters whose subpath requires an optional peer dependency. Throws
 * a clear, actionable error when the peer is missing.
 */
export function requirePeer(name: string, subpath: string): never {
  return kitRequirePeer(name, `@xtandard/webhooks/${subpath}`);
}
