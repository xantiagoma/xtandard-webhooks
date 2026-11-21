import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createRedisStorage, type RedisWebhooksStorage } from "../src/storage/redis.ts";
import { hasDeliveryQueue, isWatchable } from "../src/storage/contract.ts";
import { dueKey } from "../src/keys.ts";
import { runStorageContractTests } from "./storage-contract.ts";

const REDIS_URL = process.env.REDIS_URL;

/**
 * Live conformance suite — runs only when `REDIS_URL` is set, so CI without a
 * Redis server simply skips it. Every `makeStorage` call gets a unique key
 * prefix so each contract test starts empty and never collides with real data;
 * everything is cleaned up and closed in `afterAll`. The `deliveryQueue`
 * battery exercises the native zset-backed `claimDue`.
 */
describe.skipIf(!REDIS_URL)("redis storage (live conformance)", () => {
  const runId = `xtandard-webhooks-test:${Date.now()}`;
  let counter = 0;
  const opened: RedisWebhooksStorage[] = [];

  runStorageContractTests(
    "redis",
    () => {
      const storage = createRedisStorage({ url: REDIS_URL, prefix: `${runId}:${counter++}` });
      opened.push(storage);
      return storage;
    },
    {
      t: { describe, test, expect },
      capabilities: { compareAndSwap: true, watch: { settleMs: 150 } },
      deliveryQueue: true,
      timeout: 30_000,
    },
  );

  beforeAll(async () => {
    // Keyspace notifications are off by default (e.g. the CI redis service).
    const { createClient } = (await import("redis")) as unknown as {
      createClient: (opts: Record<string, unknown>) => {
        connect(): Promise<unknown>;
        configSet(p: string, v: string): Promise<unknown>;
        quit(): Promise<unknown>;
      };
    };
    const cfg = createClient({ url: REDIS_URL });
    await cfg.connect();
    await cfg.configSet("notify-keyspace-events", "KEA");
    await cfg.quit();
  });

  afterAll(async () => {
    for (const storage of opened) {
      for (const key of await storage.getKeys("")) await storage.removeItem(key);
      await storage.close();
    }
  });
});

/** The due zset stays in step with the plain keys (live). */
describe.skipIf(!REDIS_URL)("createRedisStorage (live)", () => {
  const prefix = `xtandard-webhooks-live:${Date.now()}`;
  let storage: RedisWebhooksStorage;

  beforeAll(() => {
    storage = createRedisStorage({ url: REDIS_URL, prefix });
  });

  afterAll(async () => {
    for (const key of await storage.getKeys("")) await storage.removeItem(key);
    await storage.close();
  });

  test("removing a due key also removes it from the due zset (no stale claims)", async () => {
    const key = dueKey("acme", Date.now() - 1000, "dlv_removed");
    await storage.setItem(key, { app: "acme", deliveryId: "dlv_removed" });
    await storage.removeItem(key);
    // The delivery itself never existed; a stale zset member would surface it
    // through claimDue (and be swept) — a removed key must yield nothing at all.
    const claimed = await storage.claimDue({
      now: new Date().toISOString(),
      limit: 10,
      leaseMs: 60_000,
    });
    expect(claimed).toEqual([]);
    expect(await storage.getKeys("whk/acme/due/")).toEqual([]);
  });
});

/**
 * A fake node-redis client (Map-backed) recording zset operations — enough to
 * verify the adapter mirrors due-index keys into the due zset without a server.
 */
function fakeZsetClient() {
  const strings = new Map<string, string>();
  const zsets = new Map<string, Map<string, number>>();
  const zAddCalls: Array<{ key: string; score: number; value: string }> = [];
  const zRemCalls: Array<{ key: string; member: string }> = [];
  const client = {
    isOpen: true,
    on: () => client,
    connect: async () => client,
    quit: async () => undefined,
    get: async (key: string) => strings.get(key) ?? null,
    set: async (key: string, value: string) => {
      strings.set(key, value);
    },
    del: async (key: string) => {
      strings.delete(key);
    },
    zAdd: async (key: string, member: { score: number; value: string }) => {
      const z = zsets.get(key) ?? new Map<string, number>();
      z.set(member.value, member.score);
      zsets.set(key, z);
      zAddCalls.push({ key, score: member.score, value: member.value });
    },
    zRem: async (key: string, member: string) => {
      zsets.get(key)?.delete(member);
      zRemCalls.push({ key, member });
    },
    eval: async () => [],
    scanIterator: async function* (options?: { MATCH?: string }) {
      const match = options?.MATCH ?? "*";
      const re = new RegExp(
        `^${match.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
      );
      for (const key of strings.keys()) if (re.test(key)) yield key;
    },
    duplicate: () => client,
    pSubscribe: async () => undefined,
    disconnect: async () => undefined,
  };
  return { client: client as never, zAddCalls, zRemCalls };
}

describe("redis due-index zset maintenance (fake client)", () => {
  test("setItem on a due key mirrors it into the due zset at its due-time score", async () => {
    const { client, zAddCalls } = fakeZsetClient();
    const storage = createRedisStorage({ client, prefix: "ns" });
    const millis = 1_720_000_000_000;
    const key = dueKey("acme", millis, "dlv_1");
    await storage.setItem(key, { app: "acme", deliveryId: "dlv_1" });
    expect(zAddCalls).toEqual([{ key: "ns:whk:due", score: millis, value: key }]);
  });

  test("setItem on a non-due key leaves the zset alone", async () => {
    const { client, zAddCalls } = fakeZsetClient();
    const storage = createRedisStorage({ client, prefix: "ns" });
    await storage.setItem("whk/acme/deliveries/dlv_1", { id: "dlv_1" });
    await storage.setItem("whk/acme/metadata", { key: "acme" });
    expect(zAddCalls).toEqual([]);
  });

  test("removeItem on a due key removes the zset member", async () => {
    const { client, zRemCalls } = fakeZsetClient();
    const storage = createRedisStorage({ client, prefix: "ns" });
    const key = dueKey("acme", 1_720_000_000_000, "dlv_1");
    await storage.setItem(key, { app: "acme", deliveryId: "dlv_1" });
    await storage.removeItem(key);
    expect(zRemCalls).toEqual([{ key: "ns:whk:due", member: key }]);
  });
});

/**
 * Type/shape checks that need no live server: a created adapter exposes the
 * full {@link RedisWebhooksStorage} surface (the contract methods plus watch,
 * claimDue, and close).
 */
describe("createRedisStorage shape", () => {
  test("exposes the WebhooksStorage + watch + claimDue + close surface without connecting", () => {
    const storage = createRedisStorage({ url: "redis://localhost:6379", prefix: "x" });
    expect(typeof storage.getItem).toBe("function");
    expect(typeof storage.setItem).toBe("function");
    expect(typeof storage.removeItem).toBe("function");
    expect(typeof storage.getKeys).toBe("function");
    expect(typeof storage.watch).toBe("function");
    expect(typeof storage.close).toBe("function");
    expect(isWatchable(storage)).toBe(true);
    expect(hasDeliveryQueue(storage)).toBe(true);
  });

  test("close() before any connection is a safe no-op", async () => {
    const storage = createRedisStorage({ url: "redis://localhost:6379" });
    await expect(storage.close()).resolves.toBeUndefined();
  });
});
