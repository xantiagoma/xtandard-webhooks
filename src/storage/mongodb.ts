/**
 * MongoDB storage adapter built on the [`mongodb`](https://github.com/mongodb/node-mongodb-native)
 * driver, an optional peer dependency. You can either pass a pre-constructed
 * (optionally pre-connected) `MongoClient`, or a connection `url` to create and
 * connect a client lazily on first use.
 *
 * The backend is a single collection of `{ _id: <key>, value: <any> }` documents
 * (database `"xtandard_webhooks"`, collection `"webhooks_kv"` by default). The
 * driver is `@xtandard/kit/storage/mongodb`.
 *
 * ## Why no `watch`
 *
 * MongoDB change streams (the natural way to back {@link WatchableWebhooksStorage})
 * require a replica set or sharded cluster — they are unavailable on a standalone
 * `mongod`. To keep this adapter usable against any deployment, `watch` is
 * intentionally **not** implemented; the core feature-detects its absence via
 * {@link import("./contract.ts").isWatchable} and falls back to polling.
 *
 * @module
 */

import * as kit from "@xtandard/kit/storage/mongodb";

/**
 * Options for {@link createMongoStorage}. `dbName` defaults to
 * `"xtandard_webhooks"`, `collectionName` to `"webhooks_kv"`.
 */
export type MongoStorageOptions = kit.MongoStorageOptions;

/**
 * A compare-and-swap capable {@link WebhooksStorage} backed by MongoDB, plus a
 * `close()` method that disconnects the client — but only the one this adapter
 * created. A client you passed in is left for you to manage.
 */
export type MongoWebhooksStorage = kit.MongoKvStorage;

/**
 * Create a MongoDB-backed {@link MongoWebhooksStorage}.
 *
 * @example
 * ```ts
 * import { createMongoStorage } from "@xtandard/webhooks/storage/mongodb";
 *
 * const storage = createMongoStorage({
 *   url: "mongodb://localhost:27017",
 *   dbName: "myapp",
 *   collectionName: "webhooks_kv",
 * });
 * ```
 */
export function createMongoStorage(options: MongoStorageOptions): MongoWebhooksStorage {
  return kit.createMongoStorage({
    ...options,
    dbName: options.dbName ?? "xtandard_webhooks",
    collectionName: options.collectionName ?? "webhooks_kv",
  });
}
