import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { getTableName } from "drizzle-orm";
import { afterEach, describe, expect, test, vi } from "vitest";
import { text } from "drizzle-orm/pg-core";
import { pgWebhooksTable } from "../src/drizzle/pg.ts";
import { mysqlWebhooksTable } from "../src/drizzle/mysql.ts";
import { sqliteWebhooksTable } from "../src/drizzle/sqlite.ts";
import { createDrizzleStorage } from "../src/storage/drizzle.ts";
import { isWatchable } from "../src/storage/contract.ts";
import { runStorageContractTests } from "./storage-contract.ts";

/**
 * Run the shared WebhooksStorage contract suite against the Drizzle adapter
 * over a Postgres Drizzle database (in-process PGlite). Each run gets a fresh
 * DB; the table is created by the test (mirroring a consumer's migration — the
 * adapter itself issues no DDL). This also proves a real Drizzle db satisfies
 * the adapter's structural `db` type.
 */
runStorageContractTests("drizzle (pg/pglite)", async () => {
  const client = new PGlite();
  await client.exec(`CREATE TABLE webhooks_kv (key text PRIMARY KEY, value jsonb NOT NULL)`);
  const db = drizzle(client);
  return createDrizzleStorage({ db, table: pgWebhooksTable("webhooks_kv") });
});

describe("createDrizzleStorage (pg/pglite)", () => {
  test("round-trips nested values and isolates by prefix", async () => {
    const client = new PGlite();
    await client.exec(`CREATE TABLE kv (key text PRIMARY KEY, value jsonb NOT NULL)`);
    const storage = createDrizzleStorage({ db: drizzle(client), table: pgWebhooksTable("kv") });

    const value = { url: "https://x.example", rateLimit: 42, nested: { tags: ["a", "b"] } };
    await storage.setItem("whk/acme/endpoints/ep_1", value);
    expect(await storage.getItem("whk/acme/endpoints/ep_1")).toEqual(value);

    await storage.setItem("whk/app1/a", { v: 1 });
    await storage.setItem("whk/app2/b", { v: 2 });
    expect(await storage.getKeys("whk/app1/")).toEqual(["whk/app1/a"]);
  });

  test("setItem upserts (second write wins)", async () => {
    const client = new PGlite();
    await client.exec(`CREATE TABLE kv (key text PRIMARY KEY, value jsonb NOT NULL)`);
    const storage = createDrizzleStorage({ db: drizzle(client), table: pgWebhooksTable("kv") });
    await storage.setItem("k", { n: 1 });
    await storage.setItem("k", { n: 2 });
    expect(await storage.getItem("k")).toEqual({ n: 2 });
  });

  test("plain storage is not watchable (watch is composed via withWatch)", async () => {
    const client = new PGlite();
    await client.exec(`CREATE TABLE kv (key text PRIMARY KEY, value jsonb NOT NULL)`);
    const storage = createDrizzleStorage({ db: drizzle(client), table: pgWebhooksTable("kv") });
    expect(isWatchable(storage)).toBe(false);
  });
});

describe("table factories — shape", () => {
  afterEach(() => vi.restoreAllMocks());

  test("all three dialects expose key + value columns", () => {
    for (const t of [pgWebhooksTable("kv"), mysqlWebhooksTable("kv"), sqliteWebhooksTable("kv")]) {
      expect(t.key).toBeDefined();
      expect(t.value).toBeDefined();
    }
  });

  test("the table name defaults to xtandard_webhooks", () => {
    expect(getTableName(pgWebhooksTable())).toBe("xtandard_webhooks");
    expect(getTableName(mysqlWebhooksTable())).toBe("xtandard_webhooks");
    expect(getTableName(sqliteWebhooksTable())).toBe("xtandard_webhooks");
  });

  test("extraColumns merges additional columns onto the table", () => {
    const t = pgWebhooksTable("kv", { extraColumns: () => ({ tenantId: text("tenant_id") }) });
    expect((t as unknown as Record<string, unknown>).tenantId).toBeDefined();
    // Accepting extraIndexes must not throw (Drizzle invokes it lazily at SQL-gen).
    expect(() => pgWebhooksTable("kv", { extraIndexes: () => [] })).not.toThrow();
  });
});
