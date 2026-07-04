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
 * columns this adapter reads and writes.
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

import { eq, sql, type Column, type SQL, type Table } from "drizzle-orm";
import type { WebhooksStorage } from "./contract.ts";
import type { DrizzleKvTable } from "../drizzle/table.ts";

export type { DrizzleKvTable } from "../drizzle/table.ts";

/**
 * Minimal structural view of a Drizzle database — the query-builder entry points
 * the KV adapter uses. This is the internal contract the adapter casts `db` to;
 * the public option is typed `unknown` because a dialect-agnostic structural type
 * cannot match dialect-specific dbs (their `.from`/`.insert` want `PgTable` etc.,
 * not the base `Table`). The upsert method differs by dialect and is
 * feature-detected at runtime.
 */
interface DrizzleLikeDatabase {
  select(fields: Record<string, Column>): {
    from(table: Table): { where(where: SQL): PromiseLike<unknown[]> };
  };
  insert(table: Table): {
    values(row: { key: string; value: unknown }): {
      /** Postgres + SQLite upsert. */
      onConflictDoUpdate?(config: {
        target: Column;
        set: { value: unknown };
      }): PromiseLike<unknown>;
      /** MySQL upsert. */
      onDuplicateKeyUpdate?(config: { set: { value: unknown } }): PromiseLike<unknown>;
    };
  };
  delete(table: Table): { where(where: SQL): PromiseLike<unknown> };
}

/** Options for {@link createDrizzleStorage}. */
export interface DrizzleStorageOptions {
  /**
   * Your Drizzle database (node-postgres / mysql2 / better-sqlite3 / pglite / …).
   * Typed `unknown` intentionally — a single dialect-agnostic type can't match
   * every dialect's db; the adapter only calls `select`/`insert`/`delete`.
   */
  db: unknown;
  /** The KV table built with a `*WebhooksTable` factory (or matching that shape). */
  table: DrizzleKvTable;
}

/**
 * A {@link WebhooksStorage} over a Drizzle table. For push change-notifications,
 * compose it with {@link ./watch.withWatch} + a change source (e.g.
 * {@link ./watch.pgListenNotify}) — `watch` is orthogonal to the adapter.
 */
export type DrizzleWebhooksStorage = WebhooksStorage;

/** Escape LIKE wildcards so `getKeys` matches the prefix verbatim (paired with `ESCAPE '\'`). */
const escapeLike = (literal: string): string => literal.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Parse a value defensively — Drizzle returns json parsed, but a string is parsed too. */
const parseValue = <T>(value: unknown): T => {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as T;
    }
  }
  return value as T;
};

/**
 * Create a Drizzle-backed {@link DrizzleWebhooksStorage}. No DDL, no connection
 * ownership. The upsert dialect (Postgres/SQLite `onConflictDoUpdate` vs MySQL
 * `onDuplicateKeyUpdate`) is detected at runtime from the insert builder.
 */
export function createDrizzleStorage(options: DrizzleStorageOptions): DrizzleWebhooksStorage {
  const db = options.db as DrizzleLikeDatabase;
  const { table } = options;

  return {
    async getItem<T>(key: string): Promise<T | null> {
      const rows = (await db
        .select({ value: table.value })
        .from(table)
        .where(eq(table.key, key))) as Array<{ value: unknown }>;
      const row = rows[0];
      if (row === undefined || row.value === null || row.value === undefined) return null;
      return parseValue<T>(row.value);
    },

    async setItem<T>(key: string, value: T): Promise<void> {
      const insert = db.insert(table).values({ key, value });
      if (typeof insert.onConflictDoUpdate === "function") {
        await insert.onConflictDoUpdate({ target: table.key, set: { value } });
      } else if (typeof insert.onDuplicateKeyUpdate === "function") {
        await insert.onDuplicateKeyUpdate({ set: { value } });
      } else {
        throw new Error(
          "createDrizzleStorage: the Drizzle database exposes no known upsert method " +
            "(onConflictDoUpdate / onDuplicateKeyUpdate).",
        );
      }
    },

    async removeItem(key: string): Promise<void> {
      await db.delete(table).where(eq(table.key, key));
    },

    async getKeys(prefix: string): Promise<string[]> {
      const pattern = `${escapeLike(prefix)}%`;
      const rows = (await db
        .select({ key: table.key })
        .from(table)
        .where(sql`${table.key} like ${pattern} escape '\\'`)) as Array<{ key: unknown }>;
      return rows.map((row) => String(row.key));
    },
  };
}
