/**
 * `@xtandard/webhooks/drizzle/mysql` — MySQL Drizzle table factory for the
 * webhooks KV store. Schema-only (imports just `drizzle-orm/mysql-core`).
 *
 * Base columns: `key varchar PRIMARY KEY` (length configurable), `value json
 * NOT NULL`. `extraColumns`/`extraIndexes` mirror `drizzle-audit`.
 *
 * The `key` column uses the **`utf8mb4_bin`** collation: MySQL's default
 * (`utf8mb4_0900_ai_ci`) is case- and accent-insensitive, so keys such as
 * `…/Acme/…` and `…/acme/…` would be the same primary key. Tables created
 * from an earlier version need their `key` column re-collated; docs/STORAGE.md
 * has the `ALTER TABLE`.
 *
 * @example
 * ```ts
 * import { mysqlWebhooksTable } from "@xtandard/webhooks/drizzle/mysql";
 * export const webhooksKv = mysqlWebhooksTable();
 * ```
 *
 * @module
 */

import { mysqlKvTable, type MysqlKvTableOptions } from "@xtandard/kit/drizzle/mysql";
import type { DrizzleKvTable } from "@xtandard/kit/drizzle/mysql";

export type { DrizzleKvTable } from "@xtandard/kit/drizzle/mysql";

/**
 * Options for {@link mysqlWebhooksTable}: `keyLength` (default `512`; keep within
 * your InnoDB index-prefix limit), `keyCollation` (default `utf8mb4_bin`; opt
 * into `utf8mb4_0900_bin` / `utf8mb4_nopad_bin` for new tables),
 * `extraColumns` and `extraIndexes`.
 */
export type MysqlWebhooksTableOptions = MysqlKvTableOptions;

/**
 * Build the MySQL `mysqlTable` for the webhooks KV store: `key varchar PRIMARY
 * KEY` (`utf8mb4_bin`), `value json NOT NULL`. The table name defaults to `"xtandard_webhooks"`.
 */
export function mysqlWebhooksTable(
  name = "xtandard_webhooks",
  opts?: MysqlWebhooksTableOptions,
): DrizzleKvTable {
  return mysqlKvTable(name, opts);
}
