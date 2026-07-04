import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createPostgresStorage, type PostgresWebhooksStorage } from "../src/storage/postgres.ts";
import { runStorageContractTests } from "./storage-contract.ts";

/**
 * Run the shared {@link WebhooksStorage} contract suite against the Postgres
 * adapter, backed by an in-process PGlite instance so no server is required and
 * the tests always run. Each invocation gets a FRESH PGlite for isolation.
 */
runStorageContractTests("postgres (pglite)", async () =>
  createPostgresStorage({ client: new PGlite(), table: "kv" }),
);

/** Adapter-specific behaviour against in-process PGlite. */
describe("createPostgresStorage (pglite)", () => {
  let storage: PostgresWebhooksStorage;

  beforeAll(() => {
    storage = createPostgresStorage({ client: new PGlite(), table: "webhooks_test" });
  });

  test("round-trips a nested object value", async () => {
    const value = { url: "https://x.example", rateLimit: 42, tags: ["a", "b"], nested: { x: 1 } };
    await storage.setItem("whk/acme/endpoints/ep_1", value);
    expect(await storage.getItem("whk/acme/endpoints/ep_1")).toEqual(value);
  });

  test("returns null for a missing key", async () => {
    expect(await storage.getItem("whk/acme/does-not-exist")).toBeNull();
  });

  test("isolates by prefix", async () => {
    await storage.setItem("whk/app1/a", { v: 1 });
    await storage.setItem("whk/app2/b", { v: 2 });
    expect(await storage.getKeys("whk/app1/")).toEqual(["whk/app1/a"]);
    expect(await storage.getKeys("whk/app2/")).toEqual(["whk/app2/b"]);
  });

  test("handles deeply nested keys", async () => {
    await storage.setItem("whk/acme/attempts/dlv_1/0001", { v: 1 });
    expect(await storage.getItem("whk/acme/attempts/dlv_1/0001")).toEqual({ v: 1 });
    expect(await storage.getKeys("whk/acme/attempts/dlv_1/")).toContain(
      "whk/acme/attempts/dlv_1/0001",
    );
  });

  test("two separate PGlite instances do not share data", async () => {
    const a = createPostgresStorage({ client: new PGlite(), table: "shared" });
    const b = createPostgresStorage({ client: new PGlite(), table: "shared" });
    await a.setItem("whk/acme/only-in-a", { v: 1 });
    expect(await b.getItem("whk/acme/only-in-a")).toBeNull();
    expect(await a.getItem("whk/acme/only-in-a")).toEqual({ v: 1 });
  });
});

/** Type/shape checks that need no client connection. */
describe("createPostgresStorage shape", () => {
  test("rejects an unsafe table name", () => {
    expect(() =>
      createPostgresStorage({ client: new PGlite(), table: "bad; DROP TABLE x" }),
    ).toThrow();
  });

  test("close() with a borrowed client is a safe no-op", async () => {
    const s = createPostgresStorage({ client: new PGlite(), table: "kv" });
    await expect(s.close()).resolves.toBeUndefined();
  });
});

/**
 * Optional live-server suite — runs only when `POSTGRES_URL` is set, so CI
 * without a Postgres server simply skips it. Cleans up after itself.
 */
describe.skipIf(!process.env.POSTGRES_URL)("createPostgresStorage (live)", () => {
  const table = `xtandard_webhooks_test_${Date.now()}`;
  let storage: PostgresWebhooksStorage;

  beforeAll(() => {
    storage = createPostgresStorage({ connectionString: process.env.POSTGRES_URL, table });
  });

  afterAll(async () => {
    for (const key of await storage.getKeys("")) await storage.removeItem(key);
    await storage.close();
  });

  test("round-trips an object value", async () => {
    const value = { url: "https://x.example", rateLimit: 42, nested: { x: 1 } };
    await storage.setItem("whk/acme/endpoints/ep_1", value);
    expect(await storage.getItem("whk/acme/endpoints/ep_1")).toEqual(value);
  });

  test("getKeys isolates by prefix", async () => {
    await storage.setItem("whk/iso1/a", { v: 1 });
    await storage.setItem("whk/iso2/b", { v: 2 });
    expect(await storage.getKeys("whk/iso1/")).toEqual(["whk/iso1/a"]);
    expect(await storage.getKeys("whk/iso2/")).toEqual(["whk/iso2/b"]);
  });
});
