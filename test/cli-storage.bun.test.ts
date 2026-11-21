/**
 * The CLI builds its stores from the webhooks storage entries
 * (`storageRegistryFrom`), so the product defaults survive: a SQLite store
 * keeps the `xtandard_webhooks` table (the kit's own drivers would use
 * `xtandard_kv`). `bun:sqlite`, so this runs under `bun test`.
 *
 *   bun test test/cli-storage.bun.test.ts
 */
import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.ts";

const dirs: string[] = [];
const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test('STORAGE_DRIVER=sqlite writes the "xtandard_webhooks" table at STORAGE_SQLITE_PATH', async () => {
  const dir = mkdtempSync(join(tmpdir(), "wh-cli-sqlite-"));
  dirs.push(dir);
  const path = join(dir, "storage.sqlite");
  process.env.STORAGE_DRIVER = "sqlite";
  process.env.STORAGE_SQLITE_PATH = path;
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    expect(await run(["init", "--app", "acme"])).toBe(0);
  } finally {
    process.stdout.write = write;
  }
  const db = new Database(path, { readonly: true });
  const tables = db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all();
  const keys = db.query("SELECT key FROM xtandard_webhooks WHERE key = 'whk/acme/metadata'").all();
  db.close();
  expect(tables).toEqual([{ name: "xtandard_webhooks" }]);
  expect(keys).toEqual([{ key: "whk/acme/metadata" }]);
});
