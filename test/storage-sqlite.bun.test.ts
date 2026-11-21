/**
 * Bun-native test for the SQLite adapter (`bun:sqlite` is unavailable under Node,
 * so this runs via `bun test`, not vitest — it is excluded from the vitest glob).
 *
 *   bun test test/storage-sqlite.bun.test.ts
 */
import { Database } from "bun:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { createSqliteStorage, type SqliteWebhooksStorage } from "../src/storage/sqlite.ts";
import { runStorageContractTests } from "./storage-contract.ts";

const open: SqliteWebhooksStorage[] = [];
afterEach(() => {
  for (const s of open.splice(0)) s.close();
});

let database = new Database(":memory:");
runStorageContractTests(
  "sqlite (bun:sqlite)",
  () => {
    database = new Database(":memory:");
    return createSqliteStorage({ database });
  },
  {
    t: { describe, test, expect },
    seedLegacy: async (storage, key, raw) => {
      await storage.getKeys(""); // run the DDL
      database.query("INSERT INTO xtandard_webhooks (key, value) VALUES (?, ?)").run(key, raw);
    },
  },
);

describe("sqlite storage (webhooks defaults)", () => {
  test('the table defaults to "xtandard_webhooks" (rows from earlier releases read back)', async () => {
    const db = new Database(":memory:");
    db.run("CREATE TABLE xtandard_webhooks (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    db.query("INSERT INTO xtandard_webhooks VALUES (?, ?)").run(
      "whk/acme/metadata",
      JSON.stringify({ name: "Acme", key: "acme" }),
    );
    const storage = createSqliteStorage({ database: db });
    expect(await storage.getItem("whk/acme/metadata")).toEqual({ key: "acme", name: "Acme" });
    db.close();
  });

  test("persists across instances sharing a file", async () => {
    const path = join(tmpdir(), `webhooks-sqlite-${Date.now()}.db`);
    const a = createSqliteStorage({ path });
    await a.setItem("whk/acme/k", { v: 1 });
    a.close();
    const b = createSqliteStorage({ path });
    open.push(b);
    expect(await b.getItem("whk/acme/k")).toEqual({ v: 1 });
  });
});
