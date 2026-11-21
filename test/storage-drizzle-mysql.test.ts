import { getTableConfig, type MySqlTable } from "drizzle-orm/mysql-core";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, test } from "vitest";
import { mysqlWebhooksTable } from "../src/drizzle/mysql.ts";
import { createDrizzleStorage } from "../src/storage/drizzle.ts";
import { runStorageContractTests } from "./storage-contract.ts";

/**
 * Optional live-server suite for the Drizzle adapter over MySQL
 * (`drizzle-orm/mysql2`) — runs only when `MYSQL_URL` is set (CI provides a
 * `mysql:8` service). The table is created from the factory's own config, so
 * this also checks that `mysqlWebhooksTable()` yields a working schema (the
 * `utf8mb4_bin` key, the `ESCAPE '!'` prefix scan). Each run works in its own
 * database, dropped in `afterAll`.
 */
const MYSQL_URL = process.env.MYSQL_URL;
const dbName = `webhooks_test_${Date.now()}`;
let pool: mysql.Pool | undefined;

async function getPool(url: string): Promise<mysql.Pool> {
  if (pool) return pool;
  const admin = await mysql.createConnection({ uri: url });
  await admin.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
  await admin.end();
  pool = mysql.createPool({ uri: url, database: dbName, connectionLimit: 8 });
  return pool;
}

/** `CREATE TABLE` from a Drizzle table's own config (what a consumer's migration would emit). */
function createTableSql(table: MySqlTable): string {
  const c = getTableConfig(table);
  const columns = c.columns.map(
    (col) =>
      `\`${col.name}\` ${col.getSQLType()}${col.notNull ? " NOT NULL" : ""}${col.primary ? " PRIMARY KEY" : ""}`,
  );
  return `CREATE TABLE \`${c.name}\` (${columns.join(", ")})`;
}

let n = 0;

afterAll(async () => {
  if (!pool || !MYSQL_URL) return;
  await pool.end();
  const admin = await mysql.createConnection({ uri: MYSQL_URL });
  await admin.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
  await admin.end();
}, 120_000);

describe.skipIf(!MYSQL_URL)("createDrizzleStorage (mysql, live)", () => {
  runStorageContractTests(
    "drizzle (mysql)",
    async () => {
      const p = await getPool(MYSQL_URL!);
      const table = mysqlWebhooksTable(`kv_${n++}`);
      await p.query(createTableSql(table as unknown as MySqlTable));
      // `mysql2/promise` and `mysql2` ship separate (incompatible) Pool typings; the runtime object is the same.
      return createDrizzleStorage({ db: drizzle(p as never), table });
    },
    { t: { describe, test, expect }, timeout: 30_000 },
  );
});
