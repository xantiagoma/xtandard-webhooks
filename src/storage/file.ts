/**
 * File-system storage adapter. Persists each key as a JSON file under a base
 * directory, mirroring the slash-delimited key layout (`whk/{app}/…`) as a
 * tree of nested directories with a `.json` extension on the leaf. Each key
 * segment is encoded into a case-safe file name ({@link encodeSegment}), so keys
 * that differ only by case or accent stay distinct on case-insensitive
 * filesystems (macOS and Windows defaults). Stores written by v0.1.4 or
 * earlier used the raw segments: run {@link migrateFileStorage} once. Zero
 * external dependencies — uses `node:fs/promises`, which works in both Bun and
 * Node.
 *
 * @module
 */

import { watch as fsWatch } from "node:fs";
import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, rm, rmdir, unlink, writeFile } from "node:fs/promises";
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
 * Encode one key segment as a file name that survives case-insensitive and
 * normalization-insensitive filesystems (macOS, Windows) and never escapes its
 * directory: an uppercase letter becomes `^` + the lowercase letter, `^` becomes
 * `^^`, bytes outside `[a-z0-9._~!@,=+_-]` become `%XX`, and a leading
 * `.` is `%2E` (so `.` / `..` / dotfiles cannot appear). Lowercase segments such
 * as `whk` or `endpoints` are unchanged; `ep_3kZ…` becomes `ep_3k^z…`.
 */
export function encodeSegment(segment: string): string {
  let out = "";
  for (const byte of new TextEncoder().encode(segment)) {
    const ch = String.fromCharCode(byte);
    if (byte >= 0x41 && byte <= 0x5a) out += `^${ch.toLowerCase()}`;
    else if (ch === "^") out += "^^";
    else if (/[a-z0-9._~!@,=+_-]/.test(ch) && !(ch === "." && out === "")) out += ch;
    else out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

/** Reverse {@link encodeSegment}. */
export function decodeSegment(name: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < name.length; i++) {
    const ch = name[i] as string;
    if (ch === "^") {
      const next = name[++i] ?? "";
      bytes.push((next === "^" ? "^" : next.toUpperCase()).charCodeAt(0));
    } else if (ch === "%") {
      bytes.push(Number.parseInt(name.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(ch.charCodeAt(0));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** Whether `name` is a file name {@link encodeSegment} produces (not a legacy raw segment). */
const isEncoded = (name: string): boolean => encodeSegment(decodeSegment(name)) === name;

/**
 * Map a storage key (e.g. `whk/acme/endpoints/ep_1`) to an absolute file path
 * under `dir`: each `/`-separated segment becomes an encoded directory/file
 * name (see {@link encodeSegment}), and the leaf gets a `.json` suffix.
 */
function keyToPath(dir: string, key: string): string {
  return join(dir, ...key.split("/").map(encodeSegment)) + JSON_SUFFIX;
}

/** The `dir`-relative segments of a `.json` leaf under `dir`, or `null`. */
function leafSegments(dir: string, filePath: string): string[] | null {
  const rel = relative(dir, filePath);
  if (rel.startsWith("..") || !rel.endsWith(JSON_SUFFIX)) return null;
  return rel.slice(0, -JSON_SUFFIX.length).split(sep);
}

/**
 * Reverse {@link keyToPath}: turn an absolute (or `dir`-relative) file path back
 * into the original slash-delimited storage key. Returns `null` for paths that
 * are not `.json` leaves under `dir`, or not in the encoded layout (a store
 * written by v0.1.4 or earlier; see {@link migrateFileStorage}).
 */
function pathToKey(dir: string, filePath: string): string | null {
  const segments = leafSegments(dir, filePath);
  if (!segments?.every(isEncoded)) return null;
  return segments.map(decodeSegment).join("/");
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
  let warnedLegacy = false;

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
        else if (key === null && !warnedLegacy && leafSegments(dir, file)) {
          warnedLegacy = true;
          console.warn(
            `[@xtandard/webhooks] storage/file: ${dir} has files in the layout of v0.1.4 and earlier, ` +
              "which are ignored; run migrateFileStorage({ dir }) once to move them.",
          );
        }
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
 * One-time upgrade of a file store written by v0.1.4 or earlier, which used
 * raw key segments as file names (so keys differing only by case shared a file
 * on case-insensitive filesystems). Moves every leaf that is not in the encoded
 * layout to its {@link encodeSegment} path and removes the emptied directories.
 * Idempotent; run it with no writer on the store. Returns how many keys moved.
 *
 * @example
 * ```ts
 * import { migrateFileStorage } from "@xtandard/webhooks/storage/file";
 *
 * await migrateFileStorage({ dir: "./data/webhooks" });
 * ```
 */
export async function migrateFileStorage(options: FileStorageOptions): Promise<{ moved: number }> {
  const { dir } = options;
  let moved = 0;
  const emptied = new Set<string>();
  for (const file of await walk(dir)) {
    const segments = leafSegments(dir, file);
    if (!segments || segments.every(isEncoded)) continue;
    // A legacy segment is the raw key segment; an already-encoded one (all-lowercase
    // names such as `whk` or `endpoints` are both) decodes to itself.
    const key = segments.map((s) => (isEncoded(s) ? decodeSegment(s) : s)).join("/");
    const target = keyToPath(dir, key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await readFile(file, "utf8"), "utf8");
    await unlink(file);
    emptied.add(dirname(file));
    moved++;
  }
  // Remove legacy directories left empty, deepest first, up to (not including) dir.
  const dirs = [...emptied].sort((a, b) => b.length - a.length);
  for (let d of dirs) {
    while (d !== dir && !relative(dir, d).startsWith("..")) {
      try {
        await rmdir(d);
      } catch {
        break; // not empty (or already gone)
      }
      d = dirname(d);
    }
  }
  return { moved };
}

/**
 * Delete every file written by a {@link createFileStorage} instance by removing
 * its base directory. Exposed primarily for tests and cleanup tooling.
 */
export async function clearFileStorage(options: FileStorageOptions): Promise<void> {
  await rm(options.dir, { recursive: true, force: true });
}
