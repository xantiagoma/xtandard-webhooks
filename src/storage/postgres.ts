/**
 * Postgres storage adapter backed by a single key/value table
 * (`key text PRIMARY KEY, value jsonb`). It works with any client exposing a
 * `query(text, params?)` method that resolves to `{ rows }` — this covers
 * [`pg`](https://github.com/brianc/node-postgres) (`Pool`/`Client`) and the
 * in-process [`@electric-sql/pglite`](https://github.com/electric-sql/pglite)
 * alike. You can pass a pre-built `client`, or a `connectionString`/`url` to
 * lazily create a `pg` `Pool` on first use.
 *
 * The driver is `@xtandard/kit/storage/postgres`. The table is created on
 * demand (`CREATE TABLE IF NOT EXISTS`) the first time any operation runs; a
 * failed DDL is retried on the next call. The table name defaults to
 * `"xtandard_webhooks"`, as in every earlier release.
 *
 * @module
 */

import * as kit from "@xtandard/kit/storage/postgres";

export type { SqlClient } from "@xtandard/kit/storage/postgres";

/** Options for {@link createPostgresStorage}. `table` defaults to `"xtandard_webhooks"`. */
export type PostgresStorageOptions = kit.PostgresStorageOptions;

/**
 * A compare-and-swap capable {@link WebhooksStorage} backed by Postgres, plus a
 * `close()` method that ends the underlying pool — but only the one this
 * adapter created. A client you passed in is left for you to manage.
 */
export type PostgresWebhooksStorage = kit.PostgresKvStorage;

/** The persisted default table name. */
const DEFAULT_TABLE = "xtandard_webhooks";

/**
 * Create a Postgres-backed {@link PostgresWebhooksStorage}. The table is created
 * on first use.
 *
 * @example
 * ```ts
 * import { createPostgresStorage } from "@xtandard/webhooks/storage/postgres";
 *
 * const storage = createPostgresStorage({ connectionString: process.env.DATABASE_URL });
 * ```
 */
export function createPostgresStorage(
  options: PostgresStorageOptions = {},
): PostgresWebhooksStorage {
  return kit.createPostgresStorage({ ...options, table: options.table ?? DEFAULT_TABLE });
}
