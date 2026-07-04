/**
 * Postgres storage adapter backed by a single key/value table
 * (`key text PRIMARY KEY, value jsonb`). It works with any client exposing a
 * `query(text, params?)` method that resolves to `{ rows }` — this covers
 * [`pg`](https://github.com/brianc/node-postgres) (`Pool`/`Client`) and the
 * in-process [`@electric-sql/pglite`](https://github.com/electric-sql/pglite)
 * alike. You can pass a pre-built `client`, or a `connectionString`/`url` to
 * lazily create a `pg` `Pool` on first use.
 *
 * The table is created on demand (`CREATE TABLE IF NOT EXISTS`) the first time
 * any operation runs, guarded by a single promise so concurrent callers only
 * issue the DDL once. Values are stored as `jsonb`; both `pg` and `pglite`
 * return `jsonb` already parsed to JS, but a string is JSON-parsed defensively
 * so either driver works.
 *
 * @module
 */

import { requirePeer } from "./contract.ts";
import type { WebhooksStorage } from "./contract.ts";

/**
 * Minimal structural view of a SQL client. Both `pg`'s `Pool`/`Client` and
 * `@electric-sql/pglite`'s `PGlite` satisfy this shape.
 */
export interface SqlClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/** A client this adapter can also shut down (e.g. a `pg` `Pool`). */
interface ClosableSqlClient extends SqlClient {
  end?(): Promise<unknown>;
}

/** Options for {@link createPostgresStorage}. */
export interface PostgresStorageOptions {
  /**
   * A pre-built client exposing `query(text, params?) => Promise<{ rows }>`.
   * Both a `pg` `Pool`/`Client` and `@electric-sql/pglite` satisfy this.
   */
  client?: SqlClient;
  /**
   * Connection string used to lazily create a `pg` `Pool` (via dynamic import)
   * when no `client` is supplied.
   */
  connectionString?: string;
  /** Alias for {@link PostgresStorageOptions.connectionString}. */
  url?: string;
  /** Table name (default `"xtandard_webhooks"`). Must be a safe SQL identifier. */
  table?: string;
}

/**
 * A {@link WebhooksStorage} backed by Postgres, plus a `close()` method that
 * ends the underlying pool — but only the one this adapter created. A client
 * you passed in is left for you to manage.
 */
export interface PostgresWebhooksStorage extends WebhooksStorage {
  /** End the underlying pool if this adapter created it. No-op otherwise. */
  close(): Promise<void>;
}

/** Identifiers we are willing to interpolate into DDL/queries unquoted. */
const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Escape LIKE wildcards (`%`, `_`) and the escape char itself in a literal
 * prefix so `getKeys` matches the prefix verbatim. Paired with `ESCAPE '\'`.
 */
const escapeLike = (literal: string): string => literal.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Create a Postgres-backed {@link PostgresWebhooksStorage}. The table is created
 * lazily on first use; connection (when using `connectionString`/`url`) is also
 * lazy — the `pg` `Pool` is imported and constructed on the first operation and
 * reused thereafter.
 *
 * @example
 * ```ts
 * import { createPostgresStorage } from "@xtandard/webhooks/storage/postgres";
 *
 * // Via connection string (lazy `pg` Pool):
 * const storage = createPostgresStorage({
 *   connectionString: process.env.DATABASE_URL,
 * });
 *
 * // Or with a pre-built pg Pool / PGlite client:
 * // import { PGlite } from "@electric-sql/pglite";
 * // const storage = createPostgresStorage({ client: new PGlite() });
 * ```
 */
export function createPostgresStorage(options: PostgresStorageOptions): PostgresWebhooksStorage {
  const table = options.table ?? "xtandard_webhooks";
  if (!SAFE_IDENTIFIER.test(table)) {
    throw new Error(
      `Invalid table name ${JSON.stringify(table)}: must match ${SAFE_IDENTIFIER.source}`,
    );
  }
  const connectionString = options.connectionString ?? options.url;
  const ownsClient = !options.client;

  let client: ClosableSqlClient | undefined = options.client;
  let connecting: Promise<ClosableSqlClient> | undefined;
  let ensured: Promise<void> | undefined;

  /** Resolve a client, creating a `pg` `Pool` on first use when needed. */
  async function getClient(): Promise<ClosableSqlClient> {
    if (client) return client;
    connecting ??= (async () => {
      let Pool: new (config: { connectionString?: string }) => ClosableSqlClient;
      try {
        ({ Pool } = (await import("pg")) as unknown as {
          Pool: new (config: { connectionString?: string }) => ClosableSqlClient;
        });
      } catch {
        requirePeer("pg", "storage/postgres");
      }
      client = new Pool({ connectionString });
      return client;
    })();
    try {
      return await connecting;
    } finally {
      connecting = undefined;
    }
  }

  /** Create the backing table once, before the first operation. */
  async function ensureTable(): Promise<ClosableSqlClient> {
    const c = await getClient();
    ensured ??= (async () => {
      await c.query(
        `CREATE TABLE IF NOT EXISTS ${table} (key text PRIMARY KEY, value jsonb NOT NULL)`,
      );
    })();
    await ensured;
    return c;
  }

  /**
   * Normalise a `jsonb` column value. Both `pg` and `pglite` typically return
   * it already parsed, but parse a string defensively so either driver works.
   */
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

  return {
    async getItem<T>(key: string): Promise<T | null> {
      const c = await ensureTable();
      const { rows } = await c.query(`SELECT value FROM ${table} WHERE key = $1`, [key]);
      const row = rows[0];
      if (row === undefined || row.value === null || row.value === undefined) return null;
      return parseValue<T>(row.value);
    },

    async setItem<T>(key: string, value: T): Promise<void> {
      const c = await ensureTable();
      await c.query(
        `INSERT INTO ${table} (key, value) VALUES ($1, $2::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, JSON.stringify(value)],
      );
    },

    async removeItem(key: string): Promise<void> {
      const c = await ensureTable();
      await c.query(`DELETE FROM ${table} WHERE key = $1`, [key]);
    },

    async getKeys(prefix: string): Promise<string[]> {
      const c = await ensureTable();
      const { rows } = await c.query(`SELECT key FROM ${table} WHERE key LIKE $1 ESCAPE '\\'`, [
        `${escapeLike(prefix)}%`,
      ]);
      return rows.map((row) => String(row.key));
    },

    async close(): Promise<void> {
      if (ownsClient && client?.end) await client.end();
    },
  } satisfies PostgresWebhooksStorage;
}
