import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  clearFileStorage,
  createFileStorage,
  decodeSegment,
  encodeSegment,
  migrateFileStorage,
} from "../src/storage/file.ts";
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

runStorageContractTests("file", () => createFileStorage({ dir: freshDir() }));

describe("file storage extras", () => {
  it("getKeys on a missing base dir returns empty", async () => {
    const storage = createFileStorage({ dir: freshDir() });
    expect(await storage.getKeys("whk/")).toEqual([]);
  });

  it("clearFileStorage removes everything", async () => {
    const dir = freshDir();
    const storage = createFileStorage({ dir });
    await storage.setItem("whk/acme/a", { v: 1 });
    await clearFileStorage({ dir });
    expect(await storage.getKeys("whk/")).toEqual([]);
  });

  it("persists across instances pointed at the same dir", async () => {
    const dir = freshDir();
    await createFileStorage({ dir }).setItem("whk/acme/a", { v: 7 });
    expect(await createFileStorage({ dir }).getItem("whk/acme/a")).toEqual({ v: 7 });
  });

  it("encodes segments into case-safe, reversible file names", () => {
    expect(encodeSegment("whk")).toBe("whk");
    expect(encodeSegment("ep_1")).toBe("ep_1");
    expect(encodeSegment("Acme")).toBe("^acme");
    expect(encodeSegment("a^b")).toBe("a^^b");
    expect(encodeSegment("acmé")).toBe("acm%C3%A9");
    expect(encodeSegment("..")).toBe("%2E.");
    expect(encodeSegment("a%b*[c]")).toBe("a%25b%2A%5Bc%5D");
    for (const s of [
      "Acme",
      "acme",
      "ACME",
      "acmé",
      "a^b",
      "..",
      ".env",
      "a%b*[c]?",
      "ep_3kZ~x",
      "日本",
    ]) {
      // No letters whose case carries meaning (outside the fixed-case %XX escapes), so
      // names never collide on a case-insensitive filesystem.
      expect(encodeSegment(s).replace(/%[0-9A-F]{2}/g, "")).not.toMatch(/[A-Z]/);
      expect(decodeSegment(encodeSegment(s))).toBe(s);
    }
  });

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
    const storage = createFileStorage({ dir });
    // Legacy leaves are not served (wrong layout) until migrated; lowercase ones already match.
    expect(await storage.getKeys("whk/")).toEqual(["whk/beta/metadata"]);

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
