import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { getTableName } from "drizzle-orm";
import { afterEach, describe, expect, test, vi } from "vitest";
import { getTableConfig as getPgTableConfig, text, type PgTable } from "drizzle-orm/pg-core";
import { pgWebhooksTable } from "../src/drizzle/pg.ts";
import { getTableConfig, type MySqlTable } from "drizzle-orm/mysql-core";
import { mysqlWebhooksTable } from "../src/drizzle/mysql.ts";
import { sqliteWebhooksTable } from "../src/drizzle/sqlite.ts";
import { createDrizzleStorage } from "../src/storage/drizzle.ts";
import { runStorageContractTests } from "./storage-contract.ts";

/**
 * Run the shared WebhooksStorage contract suite against the Drizzle adapter
 * over a Postgres Drizzle database (in-process PGlite). Each run gets a fresh
 * DB; the table is created by the test (mirroring a consumer's migration — the
 * adapter itself issues no DDL). This also proves a real Drizzle db satisfies
 * the adapter's structural `db` type.
 */
let client = new PGlite();
runStorageContractTests(
  "drizzle (pg/pglite)",
  async () => {
    client = new PGlite();
    await client.exec(`CREATE TABLE webhooks_kv (key text PRIMARY KEY, value jsonb NOT NULL)`);
    return createDrizzleStorage({ db: drizzle(client), table: pgWebhooksTable("webhooks_kv") });
  },
  {
    t: { describe, test, expect },
    capabilities: { compareAndSwap: true, watch: false },
    timeout: 60_000,
    seedLegacy: async (_storage, key, raw) => {
      await client.query(`INSERT INTO webhooks_kv (key, value) VALUES ($1, $2::jsonb)`, [key, raw]);
    },
  },
);

describe("table factories — shape", () => {
  afterEach(() => vi.restoreAllMocks());

  test("all three dialects expose key + value columns", () => {
    for (const t of [pgWebhooksTable("kv"), mysqlWebhooksTable("kv"), sqliteWebhooksTable("kv")]) {
      expect(t.key).toBeDefined();
      expect(t.value).toBeDefined();
    }
  });

  test("the MySQL key column is case- and accent-sensitive (utf8mb4_bin)", () => {
    const key = getTableConfig(mysqlWebhooksTable("kv") as unknown as MySqlTable).columns.find(
      (c) => c.name === "key",
    )!;
    expect(key.getSQLType()).toBe("varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin");
    expect(key.primary).toBe(true);
    const custom = getTableConfig(
      mysqlWebhooksTable("kv", { keyLength: 191 }) as unknown as MySqlTable,
    ).columns[0]!;
    expect(custom.getSQLType()).toMatch(/^varchar\(191\) .*utf8mb4_bin$/);
  });

  test("the pg key column stays plain text (no drizzle-kit diff for existing schemas)", () => {
    const key = getPgTableConfig(pgWebhooksTable() as unknown as PgTable).columns.find(
      (c) => c.name === "key",
    )!;
    expect(key.getSQLType()).toBe("text");
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
