import { describe, expect, it, test } from "vitest";
import { createMemoryStorage } from "../src/storage/memory.ts";
import { isCompareAndSwap, isWatchable, hasDeliveryQueue } from "../src/storage/contract.ts";
import { runStorageContractTests } from "./storage-contract.ts";

runStorageContractTests("memory", () => createMemoryStorage(), {
  t: { describe, test, expect },
  capabilities: { compareAndSwap: true, watch: { settleMs: 5 } },
  deliveryQueue: true,
});

describe("memory storage extras", () => {
  it("implements every optional capability", () => {
    const storage = createMemoryStorage();
    expect(isWatchable(storage)).toBe(true);
    expect(isCompareAndSwap(storage)).toBe(true);
    expect(hasDeliveryQueue(storage)).toBe(true);
  });

  it("seeds initial data", async () => {
    const storage = createMemoryStorage({ initial: { "whk/acme/metadata": { key: "acme" } } });
    expect(await storage.getItem("whk/acme/metadata")).toEqual({ key: "acme" });
  });
});
