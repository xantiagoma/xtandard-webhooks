/**
 * `@xtandard/webhooks/drizzle/mysql` — MySQL Drizzle table factory for the
 * webhooks KV store. Schema-only (imports just `drizzle-orm/mysql-core`).
 *
 * Base columns: `key varchar PRIMARY KEY` (length configurable), `value json
 * NOT NULL`. `extraColumns`/`extraIndexes` mirror `drizzle-audit`.
 *
 * @example
 * ```ts
 * import { mysqlWebhooksTable } from "@xtandard/webhooks/drizzle/mysql";
 * export const webhooksKv = mysqlWebhooksTable();
 * ```
 *
 * @module
 */

import type { BuildColumns } from "drizzle-orm";
import {
  json,
  mysqlTable,
  varchar,
  type MySqlColumnBuilderBase,
  type MySqlTableExtraConfigValue,
} from "drizzle-orm/mysql-core";
import type { DrizzleKvTable } from "./table.ts";

export type { DrizzleKvTable } from "./table.ts";

/** The `self` passed to an {@link MysqlWebhooksTableOptions.extraIndexes} callback. */
type MysqlWebhooksColumns = BuildColumns<string, Record<string, MySqlColumnBuilderBase>, "mysql">;

/** Options for {@link mysqlWebhooksTable}. */
export interface MysqlWebhooksTableOptions {
  /**
   * `varchar` length for the `key` primary key. Default `512` (store keys are
   * short slash-delimited paths). Keep within your InnoDB index-prefix limit.
   */
  keyLength?: number;
  /** Additional columns merged into the table. */
  extraColumns?: () => Record<string, MySqlColumnBuilderBase>;
  /** Additional indexes/constraints; receives the built table for column references. */
  extraIndexes?: (table: MysqlWebhooksColumns) => MySqlTableExtraConfigValue[];
}

/**
 * Build the MySQL `mysqlTable` for the webhooks KV store: `key varchar PRIMARY
 * KEY`, `value json NOT NULL`. The table name defaults to `"xtandard_webhooks"`.
 */
export function mysqlWebhooksTable(
  name = "xtandard_webhooks",
  opts?: MysqlWebhooksTableOptions,
): DrizzleKvTable {
  const columns = {
    key: varchar("key", { length: opts?.keyLength ?? 512 }).primaryKey(),
    value: json("value").notNull(),
    ...opts?.extraColumns?.(),
  };
  // Cast to the exact `self` type Drizzle infers from `columns` — the public
  // `extraIndexes` type uses a generic column map, which is a supertype.
  const extraConfig = opts?.extraIndexes as
    | ((self: BuildColumns<string, typeof columns, "mysql">) => MySqlTableExtraConfigValue[])
    | undefined;
  return mysqlTable(name, columns, extraConfig);
}
