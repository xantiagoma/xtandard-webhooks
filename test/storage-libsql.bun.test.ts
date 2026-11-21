/**
 * Tests the libSQL/Turso adapter's logic against a **real SQL engine** without
 * needing Turso credentials or the `@libsql/client` package: a tiny fake client
 * implementing {@link LibsqlClientLike} backed by `bun:sqlite` runs the exact SQL
 * the adapter emits (CREATE / INSERT … ON CONFLICT / SELECT / DELETE / GLOB /
 * UPDATE … RETURNING). It uses `bun:sqlite`, so it runs via `bun test`, not vitest.
 *
 *   bun test test/storage-libsql.bun.test.ts
 */
import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  createLibsqlStorage,
  type LibsqlClientLike,
  type LibsqlWebhooksStorage,
} from "../src/storage/libsql.ts";
import { runStorageContractTests } from "./storage-contract.ts";

/** A `@libsql/client`-shaped client backed by an in-memory `bun:sqlite` database. */
function fakeLibsqlClient(): LibsqlClientLike {
  const db = new Database(":memory:");
  return {
    async execute(stmt) {
      if (typeof stmt === "string") {
        db.run(stmt);
        return { rows: [] };
      }
      // `all` also returns the rows of `UPDATE … RETURNING` (the compare-and-swap).
      const { sql, args } = stmt;
      return { rows: db.query(sql).all(...(args as never[])) as Array<Record<string, unknown>> };
    },
    close() {
      db.close();
    },
  };
}

const open: LibsqlWebhooksStorage[] = [];
afterEach(() => {
  for (const s of open.splice(0)) s.close();
});

let client = fakeLibsqlClient();
runStorageContractTests(
  "libsql (bun:sqlite-backed fake client)",
  () => {
    client = fakeLibsqlClient();
    const storage = createLibsqlStorage({ client });
    open.push(storage);
    return storage;
  },
  {
    t: { describe, test, expect },
    seedLegacy: async (storage, key, raw) => {
      await storage.getKeys(""); // run the DDL
      await client.execute({
        sql: "INSERT INTO xtandard_webhooks (key, value) VALUES (?, ?)",
        args: [key, raw],
      });
    },
  },
);

describe("libsql storage (webhooks defaults)", () => {
  test('the table defaults to "xtandard_webhooks"', async () => {
    const c = fakeLibsqlClient();
    const storage = createLibsqlStorage({ client: c });
    await storage.setItem("whk/acme/k", { v: 1 });
    const { rows } = await c.execute({ sql: "SELECT key FROM xtandard_webhooks", args: [] });
    expect(Array.from(rows)).toEqual([{ key: "whk/acme/k" }]);
  });

  test("requires a client or url", async () => {
    await expect(createLibsqlStorage({}).getItem("k")).rejects.toThrow(/client.*url/);
  });
});
