/**
 * SQLite storage adapter built on `bun:sqlite` — **Bun only**, zero npm deps.
 * Ideal for single-node deployments and local/dev persistence: durable, fast, and
 * file-backed (or in-memory). For multi-node runtimes prefer Redis/Postgres.
 *
 * The driver is `@xtandard/kit/storage/sqlite`. `bun:sqlite` is loaded on first
 * use, so importing this module works under Node; opening a database needs Bun.
 * The table (default `"xtandard_webhooks"`) is created on first use.
 *
 * ```ts
 * import { createSqliteStorage } from "@xtandard/webhooks/storage/sqlite";
 * const storage = createSqliteStorage({ path: "./webhooks.sqlite" });
 * ```
 *
 * @module
 */

import * as kit from "@xtandard/kit/storage/sqlite";

/** Options for {@link createSqliteStorage}. `table` defaults to `"xtandard_webhooks"`. */
export type SqliteStorageOptions = kit.SqliteStorageOptions;

/** A compare-and-swap capable {@link WebhooksStorage} backed by SQLite, plus `close()`. */
export type SqliteWebhooksStorage = kit.SqliteKvStorage;

/**
 * Create a SQLite-backed storage. Requires the Bun runtime (`bun:sqlite`).
 *
 * @example
 * ```ts
 * import { createSqliteStorage } from "@xtandard/webhooks/storage/sqlite";
 *
 * // File-backed (persists across restarts):
 * const storage = createSqliteStorage({ path: "./webhooks.sqlite" });
 *
 * // In-memory (reset each run, useful for tests):
 * // const storage = createSqliteStorage({ path: ":memory:" });
 * ```
 */
export function createSqliteStorage(options: SqliteStorageOptions = {}): SqliteWebhooksStorage {
  return kit.createSqliteStorage({ ...options, table: options.table ?? "xtandard_webhooks" });
}
