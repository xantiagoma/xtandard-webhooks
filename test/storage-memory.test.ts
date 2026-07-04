import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../src/storage/memory.ts";
import { isCompareAndSwap, isWatchable, hasDeliveryQueue } from "../src/storage/contract.ts";
import { runStorageContractTests } from "./storage-contract.ts";

runStorageContractTests("memory", () => createMemoryStorage(), { deliveryQueue: true });

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

  it("clones on read and write (no shared references)", async () => {
    const storage = createMemoryStorage();
    const value = { nested: { count: 1 } };
    await storage.setItem("whk/k", value);
    value.nested.count = 99;
    const read = await storage.getItem<typeof value>("whk/k");
    expect(read?.nested.count).toBe(1);
    read!.nested.count = 42;
    expect((await storage.getItem<typeof value>("whk/k"))?.nested.count).toBe(1);
  });

  it("watch fires on update and remove, filtered by prefix", async () => {
    const storage = createMemoryStorage();
    const events: string[] = [];
    const unsubscribe = await storage.watch("whk/acme/", (e) => events.push(`${e.type}:${e.key}`));
    await storage.setItem("whk/acme/a", 1);
    await storage.setItem("whk/other/b", 2);
    await storage.removeItem("whk/acme/a");
    await new Promise((r) => setTimeout(r, 0));
    expect(events).toEqual(["update:whk/acme/a", "remove:whk/acme/a"]);
    unsubscribe();
    await storage.setItem("whk/acme/c", 3);
    await new Promise((r) => setTimeout(r, 0));
    expect(events.length).toBe(2);
  });

  it("compareAndSwap succeeds only when expectations hold", async () => {
    const storage = createMemoryStorage();
    // Missing key: expected null wins, anything else loses.
    expect(await storage.compareAndSwap({ key: "whk/k", expected: { v: 1 }, next: { v: 2 } })).toBe(
      false,
    );
    expect(await storage.compareAndSwap({ key: "whk/k", expected: null, next: { v: 1 } })).toBe(
      true,
    );
    // Present key: deep equality decides.
    expect(await storage.compareAndSwap({ key: "whk/k", expected: { v: 0 }, next: { v: 2 } })).toBe(
      false,
    );
    expect(await storage.compareAndSwap({ key: "whk/k", expected: { v: 1 }, next: { v: 2 } })).toBe(
      true,
    );
    expect(await storage.getItem("whk/k")).toEqual({ v: 2 });
  });
});
