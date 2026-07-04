import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { existsSync } from "node:fs";
import { run } from "../src/cli.ts";

const REDIS_URL = process.env.REDIS_URL;
const POSTGRES_URL = process.env.POSTGRES_URL;
const MONGO_URL = process.env.MONGO_URL;

let out: string[];
let err: string[];
const saved: Record<string, string | undefined> = {};

const DRIVER_ENV = [
  "STORAGE_DRIVER",
  "QUEUE_STORAGE_DRIVER",
  "REDIS_URL",
  "POSTGRES_URL",
  "DATABASE_URL",
  "MONGO_URL",
  "MONGO_DB",
  "STORAGE_PREFIX",
  "QUEUE_PREFIX",
  "STORAGE_PG_TABLE",
  "QUEUE_PG_TABLE",
  "STORAGE_MONGO_COLLECTION",
  "QUEUE_MONGO_COLLECTION",
];

beforeEach(() => {
  out = [];
  err = [];
  for (const k of DRIVER_ENV) saved[k] = process.env[k];
  vi.spyOn(process.stdout, "write").mockImplementation((s) => (out.push(String(s)), true));
  vi.spyOn(process.stderr, "write").mockImplementation((s) => (err.push(String(s)), true));
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const k of DRIVER_ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("cli storage drivers", () => {
  test("memory driver: init works and touches no files", async () => {
    process.env.STORAGE_DRIVER = "memory";
    const hadFileDir = existsSync("./.webhooks");
    expect(await run(["init"])).toBe(0);
    expect(out.join("")).toContain("Initialized");
    // Guards against the driver env var being misread and silently falling
    // back to the file driver (which would write ./.webhooks in the cwd).
    if (!hadFileDir) expect(existsSync("./.webhooks")).toBe(false);
  });

  test("split planes: QUEUE_STORAGE_DRIVER builds a second store", async () => {
    process.env.STORAGE_DRIVER = "memory";
    process.env.QUEUE_STORAGE_DRIVER = "memory";
    expect(await run(["init"])).toBe(0);
    expect(out.join("")).toContain("Initialized");
  });

  test.skipIf(!REDIS_URL)("redis driver: init connects and initializes", async () => {
    process.env.STORAGE_DRIVER = "redis";
    process.env.STORAGE_PREFIX = `cli-webhooks:${Date.now()}`;
    expect(await run(["init"])).toBe(0);
    expect(out.join("")).toContain("Initialized");
  });

  test.skipIf(!POSTGRES_URL)("postgres driver: init connects and initializes", async () => {
    process.env.STORAGE_DRIVER = "postgres";
    process.env.STORAGE_PG_TABLE = `cli_webhooks_${Date.now()}`;
    expect(await run(["init"])).toBe(0);
    expect(out.join("")).toContain("Initialized");
  });

  test.skipIf(!MONGO_URL)("mongodb driver: init connects and initializes", async () => {
    process.env.STORAGE_DRIVER = "mongodb";
    process.env.MONGO_DB = `cli_webhooks_${Date.now()}`;
    expect(await run(["init"])).toBe(0);
    expect(out.join("")).toContain("Initialized");
  });
});
