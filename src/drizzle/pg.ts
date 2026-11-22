/**
 * `@xtandard/webhooks/drizzle/pg` — a Drizzle table factory for the webhooks KV
 * store.
 *
 * Schema-only (imports just `drizzle-orm/pg-core`, never the webhooks core), so
 * it is safe to use inside a Drizzle schema file. The base table is the store's
 * KV shape (`key text PRIMARY KEY`, `value jsonb NOT NULL`); adding it to your
 * schema brings the webhooks table into your normal `drizzle-kit`
 * generate/migrate flow instead of an adapter-side `CREATE TABLE`.
 * `extraColumns`/`extraIndexes` mirror the `drizzle-audit` factories for when
 * you want to extend it.
 *
 * @example
 * ```ts
 * // schema.ts
 * import { pgWebhooksTable } from "@xtandard/webhooks/drizzle/pg";
 * export const webhooksKv = pgWebhooksTable();
 *
 * // then: createDrizzleStorage({ db, table: webhooksKv })
 * ```
 *
 * @module
 */

import { pgKvTable, type PgKvTableOptions } from "@xtandard/kit/drizzle/pg";
import type { DrizzleKvTable } from "@xtandard/kit/drizzle/pg";

export type { DrizzleKvTable } from "@xtandard/kit/drizzle/pg";

/**
 * Options for {@link pgWebhooksTable}: `schema` (Postgres namespace; default the
 * public schema), `extraColumns`, `extraIndexes`, and `keyCollation` (default
 * `null`: a plain `text` key, as every earlier release; `"C"` for bytewise,
 * index-usable prefixes on new tables).
 */
export type PgWebhooksTableOptions = PgKvTableOptions;

/**
 * Build the Drizzle `pgTable` for the webhooks KV store. Base columns are fixed —
 * `key text PRIMARY KEY`, `value jsonb NOT NULL` — and required by
 * `createDrizzleStorage`; `schema`/`extraColumns`/`extraIndexes` extend it.
 * The table name defaults to `"xtandard_webhooks"`. The key keeps the plain
 * `text` type of earlier releases, so existing schemas see no `drizzle-kit`
 * diff; prefix queries are exact either way.
 */
export function pgWebhooksTable(
  name = "xtandard_webhooks",
  opts?: PgWebhooksTableOptions,
): DrizzleKvTable {
  return pgKvTable(name, { keyCollation: null, ...opts });
}
