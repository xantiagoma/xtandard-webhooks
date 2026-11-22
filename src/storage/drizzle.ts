/**
 * Drizzle storage adapter — a {@link WebhooksStorage} over a **consumer-owned**
 * Drizzle table and database. Unlike {@link ./postgres.createPostgresStorage} it
 * issues **no DDL** (the table lives in your Drizzle schema + migrations) and
 * **owns no connection** (it reuses the `db` you pass, and never closes it).
 *
 * Dialect-agnostic: works with Postgres, MySQL, and SQLite Drizzle databases.
 * Build the backing table with the matching factory —
 * {@link ../drizzle/pg.pgWebhooksTable} / {@link ../drizzle/mysql.mysqlWebhooksTable} /
 * {@link ../drizzle/sqlite.sqliteWebhooksTable} — whose fixed `key`/`value`
 * columns this adapter reads and writes. The driver is
 * `@xtandard/kit/storage/drizzle`; on MySQL a write whose key differs from a
 * stored one only by trailing spaces throws `KeyCollisionError`.
 *
 * @example
 * ```ts
 * import { drizzle } from "drizzle-orm/node-postgres";
 * import { createDrizzleStorage } from "@xtandard/webhooks/storage/drizzle";
 * import { pgWebhooksTable } from "@xtandard/webhooks/drizzle/pg";
 *
 * export const webhooksKv = pgWebhooksTable(); // add to your schema + migrate
 * const db = drizzle(pool);                    // your existing pool
 * const storage = createDrizzleStorage({ db, table: webhooksKv });
 * ```
 *
 * @module
 */

import * as kit from "@xtandard/kit/storage/drizzle";

export {
  KeyCollisionError,
  type DrizzleKvStorage as DrizzleWebhooksStorage,
  type DrizzleKvTable,
  type DrizzleStorageOptions,
} from "@xtandard/kit/storage/drizzle";

/** Create a Drizzle-backed storage over your `db` and a `*WebhooksTable` table. No DDL. */
export function createDrizzleStorage(options: kit.DrizzleStorageOptions): kit.DrizzleKvStorage {
  return kit.createDrizzleStorage({ subpath: "@xtandard/webhooks/storage/drizzle", ...options });
}
