/**
 * libSQL / [Turso](https://turso.tech) storage adapter built on the
 * [`@libsql/client`](https://github.com/tursodatabase/libsql-client-ts) package
 * (an optional peer dependency). It speaks the same SQL dialect as SQLite but
 * works against a **remote, replicated, edge-distributed** database — or a local
 * file / embedded replica — so it suits multi-node and edge runtimes where
 * `bun:sqlite` (single-file, Bun-only) does not.
 *
 * Pass either a pre-constructed `client`, or `url` (+ optional `authToken`) to let
 * the adapter construct one lazily on first use. An optional `prefix` is **not**
 * used here — keys are stored verbatim as the primary key; namespace via a
 * distinct `table` or a separate database instead.
 *
 * ```ts
 * import { createLibsqlStorage } from "@xtandard/webhooks/storage/libsql";
 *
 * // Turso (remote):
 * const storage = createLibsqlStorage({
 *   url: process.env.TURSO_DATABASE_URL!,    // libsql://<db>-<org>.turso.io
 *   authToken: process.env.TURSO_AUTH_TOKEN!,
 * });
 *
 * // Local file or embedded replica:
 * // const storage = createLibsqlStorage({ url: "file:webhooks.db" });
 * ```
 *
 * @module
 */

import { requirePeer } from "./contract.ts";
import type { WebhooksStorage } from "./contract.ts";

/** Options for {@link createLibsqlStorage}. */
export interface LibsqlStorageOptions {
  /** libSQL connection URL (`libsql://…`, `https://…`, `file:…`, `:memory:`). Used when no `client`. */
  url?: string;
  /** Turso auth token for remote databases. */
  authToken?: string;
  /** A pre-constructed `@libsql/client` client to use instead of connecting. */
  client?: LibsqlClientLike;
  /** Table name (default `"xtandard_webhooks"`). Validated as a safe identifier. */
  table?: string;
}

/** A {@link WebhooksStorage} backed by libSQL/Turso, plus `close()`. */
export interface LibsqlWebhooksStorage extends WebhooksStorage {
  /** Close the client if this adapter created it; no-op for a borrowed instance. */
  close(): void;
}

/** Minimal structural view of the `@libsql/client` surface this adapter uses. */
export interface LibsqlClientLike {
  execute(
    stmt: string | { sql: string; args: unknown[] },
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
  close(): void;
}

const escapeLike = (prefix: string): string => prefix.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Create a libSQL/Turso-backed {@link LibsqlWebhooksStorage}. The table is created
 * on first use; connection (when constructed from `url`) is lazy and shared.
 *
 * @example
 * ```ts
 * import { createLibsqlStorage } from "@xtandard/webhooks/storage/libsql";
 *
 * const storage = createLibsqlStorage({
 *   url: process.env.TURSO_DATABASE_URL!,
 *   authToken: process.env.TURSO_AUTH_TOKEN,
 * });
 * // process.on("SIGTERM", () => storage.close());
 * ```
 */
export function createLibsqlStorage(options: LibsqlStorageOptions): LibsqlWebhooksStorage {
  const table = options.table ?? "xtandard_webhooks";
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
    throw new Error(`Invalid table name: ${JSON.stringify(table)}`);
  }

  const ownsClient = !options.client;
  let client: LibsqlClientLike | undefined = options.client;
  let ready: Promise<LibsqlClientLike> | undefined;

  /** Resolve a connected client and ensure the table exists (once). */
  function getClient(): Promise<LibsqlClientLike> {
    ready ??= (async () => {
      if (!client) {
        if (!options.url) {
          throw new Error("createLibsqlStorage requires either a `client` or a `url`");
        }
        let createClient: (opts: { url: string; authToken?: string }) => LibsqlClientLike;
        try {
          // Non-literal specifier so the type-checker doesn't require the optional
          // peer to be installed at build time (it's resolved at runtime only).
          const specifier: string = "@libsql/client";
          ({ createClient } = (await import(specifier)) as {
            createClient: (opts: { url: string; authToken?: string }) => LibsqlClientLike;
          });
        } catch {
          requirePeer("@libsql/client", "storage/libsql");
        }
        client = createClient({ url: options.url, authToken: options.authToken });
      }
      await client.execute(
        `CREATE TABLE IF NOT EXISTS ${table} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
      );
      return client;
    })();
    return ready;
  }

  return {
    async getItem<T>(key: string): Promise<T | null> {
      const c = await getClient();
      const { rows } = await c.execute({
        sql: `SELECT value FROM ${table} WHERE key = ?`,
        args: [key],
      });
      const value = rows[0]?.value;
      return typeof value === "string" ? (JSON.parse(value) as T) : null;
    },

    async setItem<T>(key: string, value: T): Promise<void> {
      const c = await getClient();
      await c.execute({
        sql: `INSERT INTO ${table} (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        args: [key, JSON.stringify(value)],
      });
    },

    async removeItem(key: string): Promise<void> {
      const c = await getClient();
      await c.execute({ sql: `DELETE FROM ${table} WHERE key = ?`, args: [key] });
    },

    async getKeys(prefix: string): Promise<string[]> {
      const c = await getClient();
      const { rows } = await c.execute({
        sql: `SELECT key FROM ${table} WHERE key LIKE ? ESCAPE '\\'`,
        args: [`${escapeLike(prefix)}%`],
      });
      return rows.map((r) => String(r.key));
    },

    close(): void {
      if (ownsClient) client?.close();
    },
  } satisfies LibsqlWebhooksStorage;
}
