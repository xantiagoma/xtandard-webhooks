/**
 * Storage contracts. The base {@link WebhooksStorage} is intentionally tiny —
 * four async methods — so users can bring their own backend. Optional
 * capabilities (watch, transactions, compare-and-swap, native delivery-queue
 * claiming) are separate interfaces that adapters may implement and the core
 * feature-detects.
 *
 * @module
 */

import type { Delivery } from "../schema.ts";

/** The minimal key/value contract every storage backend must satisfy. */
export interface WebhooksStorage {
  /** Read a value, or `null` if absent. */
  getItem<T>(key: string): Promise<T | null>;
  /** Write a value (overwriting any existing). */
  setItem<T>(key: string, value: T): Promise<void>;
  /** Delete a key (no-op if absent). */
  removeItem(key: string): Promise<void>;
  /** List all keys beginning with `prefix`. */
  getKeys(prefix: string): Promise<string[]>;
}

/** A storage change event delivered to {@link WatchableWebhooksStorage.watch} callbacks. */
export interface StorageChangeEvent {
  type: "update" | "remove";
  key: string;
}

/** Storage that can push change notifications (e.g. Redis pub/sub, fs.watch). */
export interface WatchableWebhooksStorage extends WebhooksStorage {
  /**
   * Subscribe to changes under `prefix`. Resolves to an unsubscribe function.
   */
  watch(prefix: string, callback: (event: StorageChangeEvent) => void): Promise<() => void>;
}

/** Storage that supports atomic multi-key transactions. */
export interface TransactionalWebhooksStorage extends WebhooksStorage {
  transaction<T>(callback: (tx: WebhooksStorage) => Promise<T>): Promise<T>;
}

/** Storage that supports optimistic concurrency via compare-and-swap. */
export interface CompareAndSwapWebhooksStorage extends WebhooksStorage {
  compareAndSwap<T>(input: { key: string; expected: T | null; next: T }): Promise<boolean>;
}

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
export interface DeliveryQueueStorage extends WebhooksStorage {
  claimDue(input: { now: string; limit: number; leaseMs: number }): Promise<Delivery[]>;
}

/** Runtime feature-detection: does this storage implement `watch`? */
export function isWatchable(storage: WebhooksStorage): storage is WatchableWebhooksStorage {
  return typeof (storage as Partial<WatchableWebhooksStorage>).watch === "function";
}

/** Runtime feature-detection: does this storage implement `transaction`? */
export function isTransactional(storage: WebhooksStorage): storage is TransactionalWebhooksStorage {
  return typeof (storage as Partial<TransactionalWebhooksStorage>).transaction === "function";
}

/** Runtime feature-detection: does this storage implement `compareAndSwap`? */
export function isCompareAndSwap(
  storage: WebhooksStorage,
): storage is CompareAndSwapWebhooksStorage {
  return typeof (storage as Partial<CompareAndSwapWebhooksStorage>).compareAndSwap === "function";
}

/** Runtime feature-detection: does this storage implement `claimDue`? */
export function hasDeliveryQueue(storage: WebhooksStorage): storage is DeliveryQueueStorage {
  return typeof (storage as Partial<DeliveryQueueStorage>).claimDue === "function";
}

/**
 * Helper for adapters whose subpath requires an optional peer dependency. Throws
 * a clear, actionable error when the peer is missing.
 */
export function requirePeer(name: string, subpath: string): never {
  throw new Error(
    `@xtandard/webhooks/${subpath} requires the "${name}" package. Install it with: bun add ${name}`,
  );
}
