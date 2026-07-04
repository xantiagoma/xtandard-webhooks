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

import type { BuildColumns } from "drizzle-orm";
import {
  sqliteTable,
  text,
  type SQLiteColumnBuilderBase,
  type SQLiteTableExtraConfigValue,
} from "drizzle-orm/sqlite-core";
import type { DrizzleKvTable } from "./table.ts";

export type { DrizzleKvTable } from "./table.ts";

/** The `self` passed to an {@link SqliteWebhooksTableOptions.extraIndexes} callback. */
type SqliteWebhooksColumns = BuildColumns<
  string,
  Record<string, SQLiteColumnBuilderBase>,
  "sqlite"
>;

/** Options for {@link sqliteWebhooksTable}. */
export interface SqliteWebhooksTableOptions {
  /** Additional columns merged into the table. */
  extraColumns?: () => Record<string, SQLiteColumnBuilderBase>;
  /** Additional indexes/constraints; receives the built table for column references. */
  extraIndexes?: (table: SqliteWebhooksColumns) => SQLiteTableExtraConfigValue[];
}

/**
 * Build the SQLite `sqliteTable` for the webhooks KV store: `key text PRIMARY
 * KEY`, `value text NOT NULL` (JSON mode). The table name defaults to
 * `"xtandard_webhooks"`.
 */
export function sqliteWebhooksTable(
  name = "xtandard_webhooks",
  opts?: SqliteWebhooksTableOptions,
): DrizzleKvTable {
  const columns = {
    key: text("key").primaryKey(),
    value: text("value", { mode: "json" }).notNull(),
    ...opts?.extraColumns?.(),
  };
  // Cast to the exact `self` type Drizzle infers from `columns` — the public
  // `extraIndexes` type uses a generic column map, which is a supertype.
  const extraConfig = opts?.extraIndexes as
    | ((self: BuildColumns<string, typeof columns, "sqlite">) => SQLiteTableExtraConfigValue[])
    | undefined;
  return sqliteTable(name, columns, extraConfig);
}
