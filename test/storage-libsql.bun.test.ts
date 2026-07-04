/**
 * Tests the libSQL/Turso adapter's logic against a **real SQL engine** without
 * needing Turso credentials or the `@libsql/client` package: a tiny fake client
 * implementing {@link LibsqlClientLike} backed by `bun:sqlite` runs the exact SQL
 * the adapter emits (CREATE / INSERT … ON CONFLICT / SELECT / DELETE / LIKE
 * ESCAPE). It uses `bun:sqlite`, so it runs via `bun test`, not vitest.
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

/** A `@libsql/client`-shaped client backed by an in-memory `bun:sqlite` database. */
function fakeLibsqlClient(): LibsqlClientLike {
  const db = new Database(":memory:");
  return {
    async execute(stmt) {
      if (typeof stmt === "string") {
        db.run(stmt);
        return { rows: [] };
      }
      const { sql, args } = stmt;
      if (/^\s*select/i.test(sql)) {
        return { rows: db.query(sql).all(...(args as never[])) as Array<Record<string, unknown>> };
      }
      db.query(sql).run(...(args as never[]));
      return { rows: [] };
    },
    close() {
      db.close();
    },
  };
}

const open: LibsqlWebhooksStorage[] = [];
const make = (): LibsqlWebhooksStorage => {
  const storage = createLibsqlStorage({ client: fakeLibsqlClient() });
  open.push(storage);
  return storage;
};

afterEach(() => {
  for (const s of open.splice(0)) s.close();
});

describe("libsql storage (bun:sqlite-backed fake client)", () => {
  test("returns null for a missing key", async () => {
    expect(await make().getItem("whk/acme/missing")).toBeNull();
  });

  test("round-trips an object value", async () => {
    const storage = make();
    const value = { url: "https://x.example", rateLimit: 42, tags: ["a", "b"], nested: { x: 1 } };
    await storage.setItem("whk/acme/endpoints/ep_1", value);
    expect(await storage.getItem("whk/acme/endpoints/ep_1")).toEqual(value);
  });

  test("overwrites an existing key (ON CONFLICT)", async () => {
    const storage = make();
    await storage.setItem("whk/acme/k", { v: 1 });
    await storage.setItem("whk/acme/k", { v: 2 });
    expect(await storage.getItem("whk/acme/k")).toEqual({ v: 2 });
  });

  test("removeItem deletes a key; missing is a no-op", async () => {
    const storage = make();
    await storage.setItem("whk/acme/k", { v: 1 });
    await storage.removeItem("whk/acme/k");
    expect(await storage.getItem("whk/acme/k")).toBeNull();
    await storage.removeItem("whk/acme/nope");
  });

  test("getKeys lists + isolates by prefix (LIKE ESCAPE)", async () => {
    const storage = make();
    await storage.setItem("whk/app1/a", 1);
    await storage.setItem("whk/app1/b", 2);
    await storage.setItem("whk/app2/c", 3);
    expect((await storage.getKeys("whk/app1/")).sort()).toEqual(["whk/app1/a", "whk/app1/b"]);
    expect(await storage.getKeys("whk/app2/")).toEqual(["whk/app2/c"]);
    expect(await storage.getKeys("whk/none/")).toEqual([]);
  });

  test("rejects unsafe table names", () => {
    expect(() => createLibsqlStorage({ client: fakeLibsqlClient(), table: "bad; drop" })).toThrow();
  });

  test("requires a client or url", () => {
    const storage = createLibsqlStorage({});
    expect(storage.getItem("k")).rejects.toThrow(/client.*or.*url/i);
  });
});
