import { afterAll, describe, expect, test } from "vitest";
import { MongoClient } from "mongodb";
import { createMongoStorage, type MongoWebhooksStorage } from "../src/storage/mongodb.ts";
import { runStorageContractTests } from "./storage-contract.ts";

const MONGO_URL = process.env.MONGO_URL ?? "mongodb://localhost:27117";

// Detect a reachable MongoDB up front (short timeout) so CI without a server
// simply skips the live suite instead of hanging on connection attempts.
let available = false;
{
  const probe = new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 1500 });
  try {
    await probe.connect();
    await probe.db("admin").command({ ping: 1 });
    available = true;
  } catch {
    available = false;
  } finally {
    await probe.close().catch(() => {});
  }
}

// A unique database per run keeps concurrent/repeated runs isolated; it is
// dropped in afterAll.
const dbName = `webhooks_test_${Date.now()}`;

describe.skipIf(!available)("createMongoStorage (live)", () => {
  // Fresh collection per contract test, so the shared suite starts empty.
  let counter = 0;
  const makers: MongoWebhooksStorage[] = [];

  runStorageContractTests(
    "mongodb",
    () => {
      const storage = createMongoStorage({
        url: MONGO_URL,
        dbName,
        collectionName: `kv_${counter++}`,
      });
      makers.push(storage);
      return storage;
    },
    {
      t: { describe, test, expect },
      capabilities: { compareAndSwap: true, watch: false },
      timeout: 30_000,
    },
  );

  afterAll(async () => {
    // Drop the throwaway database, then close every client this suite opened so
    // the vitest process can exit cleanly.
    const cleanup = new MongoClient(MONGO_URL);
    try {
      await cleanup.connect();
      await cleanup.db(dbName).dropDatabase();
    } finally {
      await cleanup.close();
    }
    for (const s of makers) await s.close();
  });
});

/** The webhooks defaults, checked against a borrowed fake client (no server). */
describe("createMongoStorage (webhooks defaults)", () => {
  test('database "xtandard_webhooks" and collection "webhooks_kv" by default', async () => {
    const opened: string[] = [];
    const fakeCollection = {
      findOne: async () => null,
      find: () => ({ project: () => ({ toArray: async () => [] }) }),
    };
    const fakeClient = {
      async connect() {},
      db: (name: string) => ({
        collection: (collection: string) => {
          opened.push(`${name}/${collection}`);
          return fakeCollection;
        },
      }),
      async close() {},
    };
    const storage = createMongoStorage({ client: fakeClient as never });
    expect(await storage.getItem("whk/acme/k")).toBeNull();
    expect(opened).toEqual(["xtandard_webhooks/webhooks_kv"]);
    expect("watch" in storage).toBe(false);
  });

  test("a client or a url is required", async () => {
    await expect(createMongoStorage({}).getItem("whk/acme/k")).rejects.toThrow(
      /requires either a `client` or a `url`/,
    );
  });
});
