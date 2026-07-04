/**
 * Bun-native test for the SQLite adapter (`bun:sqlite` is unavailable under Node,
 * so this runs via `bun test`, not vitest — it is excluded from the vitest glob).
 *
 *   bun test test/storage-sqlite.bun.test.ts
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createSqliteStorage, type SqliteWebhooksStorage } from "../src/storage/sqlite.ts";

let storage: SqliteWebhooksStorage;

beforeEach(() => {
  storage = createSqliteStorage({ table: "kv" }); // in-memory
});
afterEach(() => {
  storage.close();
});

describe("sqlite storage", () => {
  test("round-trips objects and returns null for missing keys", async () => {
    expect(await storage.getItem("nope")).toBeNull();
    await storage.setItem("whk/acme/endpoints/ep_1", { url: "https://x.example", tags: ["a"] });
    expect(await storage.getItem("whk/acme/endpoints/ep_1")).toEqual({
      url: "https://x.example",
      tags: ["a"],
    });
  });

  test("setItem overwrites", async () => {
    await storage.setItem("k", "one");
    await storage.setItem("k", "two");
    expect(await storage.getItem("k")).toBe("two");
  });

  test("removeItem deletes", async () => {
    await storage.setItem("k", 1);
    await storage.removeItem("k");
    expect(await storage.getItem("k")).toBeNull();
  });

  test("getKeys filters by prefix", async () => {
    await storage.setItem("whk/a/x", 1);
    await storage.setItem("whk/a/y", 2);
    await storage.setItem("whk/b/z", 3);
    const keys = (await storage.getKeys("whk/a/")).sort();
    expect(keys).toEqual(["whk/a/x", "whk/a/y"]);
  });

  test("due-index keys sort lexicographically = chronologically", async () => {
    const pad = (n: number) => String(n).padStart(13, "0");
    await storage.setItem(`whk/acme/due/${pad(1_720_000_300_000)}~dlv_0`, {});
    await storage.setItem(`whk/acme/due/${pad(5)}~dlv_1`, {});
    await storage.setItem(`whk/acme/due/${pad(1_720_000_100_000)}~dlv_2`, {});
    const keys = (await storage.getKeys("whk/acme/due/")).sort();
    expect(keys).toEqual([
      `whk/acme/due/${pad(5)}~dlv_1`,
      `whk/acme/due/${pad(1_720_000_100_000)}~dlv_2`,
      `whk/acme/due/${pad(1_720_000_300_000)}~dlv_0`,
    ]);
  });

  test("rejects unsafe table names", () => {
    expect(() => createSqliteStorage({ table: "bad; drop table" })).toThrow();
  });

  test("persists across instances sharing a file", async () => {
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const path = join(tmpdir(), `webhooks-sqlite-${Date.now()}.db`);
    const a = createSqliteStorage({ path, table: "kv" });
    await a.setItem("k", { v: 42 });
    a.close();
    const b = createSqliteStorage({ path, table: "kv" });
    expect(await b.getItem("k")).toEqual({ v: 42 });
    b.close();
  });
});
