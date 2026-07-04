/**
 * Adapter that wraps an [unstorage](https://unstorage.unjs.io) `Storage`
 * instance as a {@link WebhooksStorage}. The caller constructs and configures
 * their own unstorage instance (with whatever driver they like) and passes it in
 * — we never import `unstorage` at runtime, only its type. `unstorage` therefore
 * remains an optional peer dependency.
 *
 * unstorage normalizes key separators to `:` internally. We write `/`-style keys
 * (which unstorage accepts), but its `getKeys(base)` returns `:`-separated keys.
 * This adapter converts those back to `/` so callers always see the keys they
 * wrote.
 *
 * @module
 */

import type { Storage } from "unstorage";
import type { WebhooksStorage } from "./contract.ts";

/** Options for {@link createUnstorageStorage}. */
export interface UnstorageStorageOptions {
  /** A pre-constructed unstorage `Storage` instance (any driver). */
  storage: Storage;
}

/** Convert an unstorage `:`-separated key back to the `/`-separated form. */
const fromUnstorageKey = (key: string): string => key.replace(/:/g, "/");

/**
 * Create a {@link WebhooksStorage} backed by an unstorage `Storage` instance.
 * unstorage auto-serializes/deserializes JSON values, so values round-trip
 * structurally; missing keys read back as `null`.
 *
 * @example
 * ```ts
 * import { createUnstorageStorage } from "@xtandard/webhooks/storage/unstorage";
 * import { createStorage } from "unstorage";
 * import fsDriver from "unstorage/drivers/fs";
 *
 * const storage = createUnstorageStorage({
 *   storage: createStorage({ driver: fsDriver({ base: "./data/webhooks" }) }),
 * });
 * ```
 */
export function createUnstorageStorage(options: UnstorageStorageOptions): WebhooksStorage {
  const { storage } = options;

  return {
    async getItem<T>(key: string): Promise<T | null> {
      const value = await storage.getItem<T>(key);
      return value === undefined ? null : value;
    },

    async setItem<T>(key: string, value: T): Promise<void> {
      // unstorage's setItem rejects `undefined`; the contract never stores it.
      await storage.setItem(key, value as NonNullable<T>);
    },

    async removeItem(key: string): Promise<void> {
      await storage.removeItem(key);
    },

    async getKeys(prefix: string): Promise<string[]> {
      // unstorage's getKeys takes a base and returns matching keys with `:`
      // separators; convert them back so callers get their original `/` keys.
      const keys = await storage.getKeys(prefix);
      return keys.map(fromUnstorageKey).filter((key) => key.startsWith(prefix));
    },
  } satisfies WebhooksStorage;
}
