import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, test, vi } from "vitest";
import { clearFileStorage, createFileStorage, migrateFileStorage } from "../src/storage/file.ts";
import { runStorageContractTests } from "./storage-contract.ts";

const roots: string[] = [];

function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "xtandard-webhooks-file-"));
  roots.push(dir);
  return join(dir, "store");
}

afterAll(async () => {
  await Promise.all(roots.map((dir) => clearFileStorage({ dir })));
});

runStorageContractTests("file", () => createFileStorage({ dir: freshDir() }), {
  t: { describe, test, expect },
  capabilities: { compareAndSwap: true, watch: { settleMs: 150 } },
});

describe("file storage extras", () => {
  it("stores keys that differ only by case in different files", async () => {
    const dir = freshDir();
    const storage = createFileStorage({ dir });
    await storage.setItem("whk/Acme/a", { v: 1 });
    await storage.setItem("whk/acme/a", { v: 2 });
    expect(readdirSync(join(dir, "whk")).sort()).toEqual(["^acme", "acme"]);
  });

  it("migrateFileStorage moves a v0.1.4 (raw-segment) store to the encoded layout", async () => {
    const dir = freshDir();
    const legacy = (rel: string, value: unknown) => {
      const path = join(dir, ...rel.split("/")) + ".json";
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, JSON.stringify(value));
    };
    legacy("whk/Acme/endpoints/ep_3kZ", { v: 1 });
    legacy("whk/beta/metadata", { v: 2 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const storage = createFileStorage({ dir });
    // Legacy leaves are not served (wrong layout) until migrated; lowercase ones already match.
    expect(await storage.getKeys("whk/")).toEqual(["whk/beta/metadata"]);
    // …and the webhooks default (`legacy: "warn"`) says so, once, with the v0.1.4 message.
    await storage.getKeys("whk/");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(
      /^\[@xtandard\/webhooks\] storage\/file: .* layout of v0\.1\.4 and earlier.*migrateFileStorage/,
    );
    warn.mockRestore();

    expect(await migrateFileStorage({ dir })).toEqual({ moved: 1 });
    expect((await storage.getKeys("whk/")).sort()).toEqual([
      "whk/Acme/endpoints/ep_3kZ",
      "whk/beta/metadata",
    ]);
    expect(await storage.getItem("whk/Acme/endpoints/ep_3kZ")).toEqual({ v: 1 });
    expect(readdirSync(join(dir, "whk")).sort()).toEqual(["^acme", "beta"]);
    expect(await migrateFileStorage({ dir })).toEqual({ moved: 0 });
  });
});
