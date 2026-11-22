import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { afterAll, describe, expect, test } from "vitest";
import { createPostgresStorage } from "../src/storage/postgres.ts";
import { runStorageContractTests } from "./storage-contract.ts";

/**
 * The kit conformance suite against the wrapped Postgres driver, backed by an
 * in-process PGlite instance so no server is required. Each invocation gets a
 * FRESH PGlite for isolation.
 */
let pglite = new PGlite();
runStorageContractTests(
  "postgres (pglite)",
  () => createPostgresStorage({ client: (pglite = new PGlite()) }),
  {
    t: { describe, test, expect },
    capabilities: { compareAndSwap: true, watch: false },
    timeout: 60_000,
    seedLegacy: async (storage, key, raw) => {
      await storage.getKeys(""); // run the DDL
      await pglite.query(`INSERT INTO xtandard_webhooks (key, value) VALUES ($1, $2::jsonb)`, [
        key,
        raw,
      ]);
    },
  },
);

describe("createPostgresStorage (webhooks defaults)", () => {
  test('the table defaults to "xtandard_webhooks" (stored-data compatibility)', async () => {
    const client = new PGlite();
    // A row written by an earlier release, in its own table, reads back.
    await client.exec(
      `CREATE TABLE xtandard_webhooks (key text PRIMARY KEY, value jsonb NOT NULL);
       INSERT INTO xtandard_webhooks VALUES ('whk/acme/metadata', '{"key":"acme","name":"Acme"}');`,
    );
    const storage = createPostgresStorage({ client });
    expect(await storage.getItem("whk/acme/metadata")).toEqual({ key: "acme", name: "Acme" });
    expect(await storage.getKeys("whk/")).toEqual(["whk/acme/metadata"]);
  });

  test("an explicit table is honoured", async () => {
    const client = new PGlite();
    await createPostgresStorage({ client, table: "custom_kv" }).setItem("whk/k", { v: 1 });
    const { rows } = await client.query<{ key: string }>(`SELECT key FROM custom_kv`);
    expect(rows).toEqual([{ key: "whk/k" }]);
  });
});

/**
 * Optional live-server suite — runs only when `POSTGRES_URL` is set, so CI
 * without a Postgres server simply skips it. Cleans up after itself.
 */
describe.skipIf(!process.env.POSTGRES_URL)("createPostgresStorage (live)", () => {
  // The conformance runner closes each storage after its case, so the tables
  // are dropped over a connection of our own.
  const tables: string[] = [];
  let n = 0;
  runStorageContractTests(
    "postgres (live)",
    () => {
      const table = `xtandard_webhooks_test_${Date.now()}_${n++}`;
      tables.push(table);
      return createPostgresStorage({ connectionString: process.env.POSTGRES_URL, table });
    },
    {
      t: { describe, test, expect },
      capabilities: { compareAndSwap: true, watch: false },
      timeout: 30_000,
    },
  );
  afterAll(async () => {
    const pool = new pg.Pool({ connectionString: process.env.POSTGRES_URL });
    for (const table of tables) await pool.query(`DROP TABLE IF EXISTS ${table}`);
    await pool.end();
  });
});
