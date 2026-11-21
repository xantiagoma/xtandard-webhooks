import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createRedisJSONStorage,
  createRedisStorage,
  type RedisWebhooksStorage,
} from "../src/storage/redis.ts";
import { runStorageContractTests } from "./storage-contract.ts";

/**
 * Integration suite — runs only when `REDIS_JSON_URL` points at a server with
 * the JSON module (Redis 8 / Redis Stack): the kit conformance suite plus the
 * native `claimDue` cases over RedisJSON documents.
 */
const REDIS_JSON_URL = process.env.REDIS_JSON_URL;
describe.skipIf(!REDIS_JSON_URL)("createRedisJSONStorage (live)", () => {
  const runId = `xtandard-webhooks-json-test:${Date.now()}`;
  let counter = 0;
  const opened: RedisWebhooksStorage[] = [];

  runStorageContractTests(
    "redisJSON",
    () => {
      const storage = createRedisJSONStorage({
        url: REDIS_JSON_URL,
        prefix: `${runId}:${counter++}`,
      });
      opened.push(storage);
      return storage;
    },
    { t: { describe, test, expect }, deliveryQueue: true, timeout: 30_000 },
  );

  describe("variants", () => {
    let storage: RedisWebhooksStorage;
    beforeAll(() => {
      storage = createRedisJSONStorage({ url: REDIS_JSON_URL, prefix: `${runId}:variants` });
      opened.push(storage);
    });

    test("string and JSON variants must not share keys (WRONGTYPE)", async () => {
      const stringStorage = createRedisStorage({
        url: REDIS_JSON_URL,
        prefix: `${runId}:variants`,
      });
      await storage.setItem("typed", { a: 1 }); // JSON type
      await expect(stringStorage.getItem("typed")).rejects.toThrow(/WRONGTYPE/i);
      await stringStorage.close();
    });
  });

  afterAll(async () => {
    for (const storage of opened) {
      for (const key of await storage.getKeys("")) await storage.removeItem(key);
      await storage.close();
    }
  });
});
