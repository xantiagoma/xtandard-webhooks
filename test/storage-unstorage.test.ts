import { createStorage } from "unstorage";
import { describe, expect, test } from "vitest";
import { createUnstorageStorage } from "../src/storage/unstorage.ts";
import { runStorageContractTests } from "./storage-contract.ts";

runStorageContractTests("unstorage (memory driver)", () =>
  createUnstorageStorage({ storage: createStorage() }),
);

describe("createUnstorageStorage specifics", () => {
  test("getKeys returns slash-separated keys, not unstorage's colon form", async () => {
    const storage = createUnstorageStorage({ storage: createStorage() });
    await storage.setItem("whk/acme/messages/msg_1", { v: 1 });
    await storage.setItem("whk/acme/metadata", { key: "acme" });
    const keys = await storage.getKeys("whk/acme/");
    expect(keys.sort()).toEqual(["whk/acme/messages/msg_1", "whk/acme/metadata"]);
    for (const k of keys) expect(k).not.toContain(":");
  });

  test("auto-deserializes JSON values and yields null for missing", async () => {
    const storage = createUnstorageStorage({ storage: createStorage() });
    expect(await storage.getItem("whk/acme/none")).toBeNull();
    await storage.setItem("whk/acme/obj", { nested: { ok: true } });
    expect(await storage.getItem("whk/acme/obj")).toEqual({ nested: { ok: true } });
  });
});
