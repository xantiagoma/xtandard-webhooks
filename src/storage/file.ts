/**
 * File-system storage adapter. Persists each key as a JSON file under a base
 * directory, mirroring the slash-delimited key layout (`whk/{app}/…`) as a
 * tree of nested directories with a `.json` extension on the leaf. Zero
 * external dependencies — uses `node:fs/promises`, which works in both Bun and
 * Node.
 *
 * @module
 */

import { watch as fsWatch } from "node:fs";
import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import type { StorageChangeEvent, WatchableWebhooksStorage } from "./contract.ts";

/** Options for {@link createFileStorage}. */
export interface FileStorageOptions {
  /** Base directory under which key files are written. Created on demand. */
  dir: string;
}

/** Suffix appended to the leaf file for every stored key. */
const JSON_SUFFIX = ".json";

/**
 * Map a storage key (e.g. `whk/acme/endpoints/ep_1`) to an absolute file path
 * inside `dir`. Each key segment becomes a directory; the last segment gains a
 * `.json` extension.
 */
function keyToPath(dir: string, key: string): string {
  return join(dir, ...key.split("/")) + JSON_SUFFIX;
}

/**
 * Reverse {@link keyToPath}: turn an absolute (or `dir`-relative) file path back
 * into the original slash-delimited storage key. Returns `null` for paths that
 * are not `.json` leaves under `dir`.
 */
function pathToKey(dir: string, filePath: string): string | null {
  const rel = relative(dir, filePath);
  if (rel.startsWith("..") || !rel.endsWith(JSON_SUFFIX)) return null;
  return rel.slice(0, -JSON_SUFFIX.length).split(sep).join("/");
}

/** Recursively collect every `.json` leaf file path under `root`. */
async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  let entries: Dirent[];
  try {
    entries = (await readdir(root, { withFileTypes: true })) as Dirent[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return out;
    throw err;
  }
  for (const entry of entries) {
    const name = entry.name.toString();
    const full = join(root, name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (entry.isFile() && name.endsWith(JSON_SUFFIX)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Create a file-backed {@link WatchableWebhooksStorage}. Values are serialized
 * as pretty-printed JSON. `watch` is implemented via `fs.watch` on the base
 * directory (recursive); it is best-effort and may coalesce or miss events on
 * platforms without recursive-watch support.
 *
 * @example
 * ```ts
 * import { createFileStorage } from "@xtandard/webhooks/storage/file";
 *
 * const storage = createFileStorage({ dir: "./data/webhooks" });
 * ```
 */
export function createFileStorage(options: FileStorageOptions): WatchableWebhooksStorage {
  const { dir } = options;

  return {
    async getItem<T>(key: string): Promise<T | null> {
      try {
        const raw = await readFile(keyToPath(dir, key), "utf8");
        return JSON.parse(raw) as T;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },

    async setItem<T>(key: string, value: T): Promise<void> {
      const path = keyToPath(dir, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(value, null, 2), "utf8");
    },

    async removeItem(key: string): Promise<void> {
      try {
        await unlink(keyToPath(dir, key));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    },

    async getKeys(prefix: string): Promise<string[]> {
      const files = await walk(dir);
      const out: string[] = [];
      for (const file of files) {
        const key = pathToKey(dir, file);
        if (key !== null && key.startsWith(prefix)) out.push(key);
      }
      return out;
    },

    async watch(
      prefix: string,
      callback: (event: StorageChangeEvent) => void,
    ): Promise<() => void> {
      // Ensure the watched root exists so fs.watch does not throw on a fresh dir.
      await mkdir(dir, { recursive: true });
      const watcher = fsWatch(dir, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const key = pathToKey(dir, join(dir, filename.toString()));
        if (key === null || !key.startsWith(prefix)) return;
        // `rename` covers both creation and deletion; we cannot reliably tell
        // them apart from the event alone, so report "update" for changes and
        // "remove" only when the underlying file is gone.
        const type: StorageChangeEvent["type"] = eventType === "rename" ? "remove" : "update";
        callback({ type, key });
      });
      return () => watcher.close();
    },
  } satisfies WatchableWebhooksStorage;
}

/**
 * Delete every file written by a {@link createFileStorage} instance by removing
 * its base directory. Exposed primarily for tests and cleanup tooling.
 */
export async function clearFileStorage(options: FileStorageOptions): Promise<void> {
  await rm(options.dir, { recursive: true, force: true });
}
