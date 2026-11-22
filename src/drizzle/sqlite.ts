/**
 * `@xtandard/webhooks/drizzle/sqlite` — SQLite Drizzle table factory for the
 * webhooks KV store. Schema-only (imports just `drizzle-orm/sqlite-core`).
 *
 * Base columns: `key text PRIMARY KEY`, `value text NOT NULL` in JSON mode
 * (Drizzle serializes/parses transparently). `extraColumns`/`extraIndexes`
 * mirror `drizzle-audit`.
 *
 * @example
 * ```ts
 * import { sqliteWebhooksTable } from "@xtandard/webhooks/drizzle/sqlite";
 * export const webhooksKv = sqliteWebhooksTable();
 * ```
 *
 * @module
 */

import { sqliteKvTable, type SqliteKvTableOptions } from "@xtandard/kit/drizzle/sqlite";
import type { DrizzleKvTable } from "@xtandard/kit/drizzle/sqlite";

export type { DrizzleKvTable } from "@xtandard/kit/drizzle/sqlite";

/** Options for {@link sqliteWebhooksTable}: `extraColumns` and `extraIndexes`. */
export type SqliteWebhooksTableOptions = SqliteKvTableOptions;

/**
 * Build the Drizzle `sqliteTable` for the webhooks KV store: `key text PRIMARY
 * KEY`, `value text NOT NULL` (JSON mode). The table name defaults to
 * `"xtandard_webhooks"`.
 */
export function sqliteWebhooksTable(
  name = "xtandard_webhooks",
  opts?: SqliteWebhooksTableOptions,
): DrizzleKvTable {
  return sqliteKvTable(name, opts);
}
