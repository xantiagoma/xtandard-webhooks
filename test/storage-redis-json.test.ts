import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  createRedisJSONStorage,
  createRedisStorage,
  type RedisWebhooksStorage,
} from "../src/storage/redis.ts";
import type { RedisClientType } from "redis";

/**
 * A fake node-redis client backing a Map: `json.*` stores live JS values (as
 * RedisJSON does), plain get/set stores strings. Lets the unit suite verify the
 * JSON codec + prefixing without a server.
 */
function fakeClient() {
  const jsonStore = new Map<string, unknown>();
  const stringStore = new Map<string, string>();
  const client = {
    isOpen: true,
    on: () => client,
    connect: async () => client,
    quit: async () => undefined,
    get: async (key: string) => stringStore.get(key) ?? null,
    set: async (key: string, value: string) => {
      stringStore.set(key, value);
    },
    del: async (key: string) => {
      jsonStore.delete(key);
      stringStore.delete(key);
    },
    zAdd: async () => undefined,
    zRem: async () => undefined,
    eval: async () => [],
    json: {
      get: vi.fn(async (key: string) => jsonStore.get(key) ?? null),
      set: vi.fn(async (key: string, _path: string, value: unknown) => {
        jsonStore.set(key, structuredClone(value));
      }),
    },
    scanIterator: async function* (options?: { MATCH?: string }) {
      const match = options?.MATCH ?? "*";
      const re = new RegExp(
        `^${match.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
      );
      for (const key of [...jsonStore.keys(), ...stringStore.keys()]) {
        if (re.test(key)) yield key;
      }
    },
    duplicate: () => client,
    pSubscribe: async () => undefined,
    disconnect: async () => undefined,
  };
  return { client: client as unknown as RedisClientType, jsonStore };
}

describe("createRedisJSONStorage (fake client)", () => {
  test("stores values via JSON.SET at the root path, prefixed", async () => {
    const { client, jsonStore } = fakeClient();
    const storage = createRedisJSONStorage({ client, prefix: "app:webhooks" });
    const value = { url: "https://x.example", nested: { tags: ["a"] } };
    await storage.setItem("whk/acme/endpoints/ep_1", value);

    // Native JSON document (not a serialized string), under the namespaced key.
    expect(jsonStore.get("app:webhooks:whk/acme/endpoints/ep_1")).toEqual(value);
    expect(await storage.getItem("whk/acme/endpoints/ep_1")).toEqual(value);
  });

  test("returns null for missing keys and after removeItem", async () => {
    const { client } = fakeClient();
    const storage = createRedisJSONStorage({ client });
    expect(await storage.getItem("nope")).toBeNull();
    await storage.setItem("k", { n: 1 });
    await storage.removeItem("k");
    expect(await storage.getItem("k")).toBeNull();
  });

  test("getKeys scans with the namespace and strips it", async () => {
    const { client } = fakeClient();
    const storage = createRedisJSONStorage({ client, prefix: "ns" });
    await storage.setItem("whk/app1/a", 1);
    await storage.setItem("whk/app2/b", 2);
    expect((await storage.getKeys("whk/app1/")).sort()).toEqual(["whk/app1/a"]);
  });

  test("falsy JSON values round-trip (false, 0)", async () => {
    const { client } = fakeClient();
    const storage = createRedisJSONStorage({ client });
    await storage.setItem("f", false);
    await storage.setItem("z", 0);
    expect(await storage.getItem("f")).toBe(false);
    expect(await storage.getItem("z")).toBe(0);
  });

  test("a client without json commands throws an actionable error", async () => {
    const { client } = fakeClient();
    delete (client as unknown as Record<string, unknown>).json;
    const storage = createRedisJSONStorage({ client });
    await expect(storage.setItem("k", 1)).rejects.toThrow(/RedisJSON module/);
  });
});

/**
 * Integration suite — runs only when `REDIS_STACK_URL` points at a server with
 * the JSON module (Redis 8 / Redis Stack). Mirrors the string adapter's live suite.
 */
const REDIS_STACK_URL = process.env.REDIS_STACK_URL;
describe.skipIf(!REDIS_STACK_URL)("createRedisJSONStorage (live Redis Stack)", () => {
  const prefix = `xtandard-webhooks-json-test:${Date.now()}`;
  let storage: RedisWebhooksStorage;

  beforeAll(() => {
    storage = createRedisJSONStorage({ url: REDIS_STACK_URL, prefix });
  });

  afterAll(async () => {
    for (const key of await storage.getKeys("")) await storage.removeItem(key);
    await storage.close();
  });

  test("round-trips a nested document as native JSON", async () => {
    const value = { url: "https://x.example", rateLimit: 42, nested: { tags: ["a", "b"] } };
    await storage.setItem("whk/acme/endpoints/ep_1", value);
    expect(await storage.getItem("whk/acme/endpoints/ep_1")).toEqual(value);
  });

  test("string and JSON variants must not share keys (WRONGTYPE)", async () => {
    const stringStorage = createRedisStorage({ url: REDIS_STACK_URL, prefix });
    await storage.setItem("typed", { a: 1 }); // JSON type
    await expect(stringStorage.getItem("typed")).rejects.toThrow(/WRONGTYPE/i);
    await stringStorage.close();
  });
});
