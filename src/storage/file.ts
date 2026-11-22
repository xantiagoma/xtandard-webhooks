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
 * The driver is `@xtandard/kit/storage/file`: writes are atomic (temporary file
 * + rename), `compareAndSwap` is serialized per key within one process, and
 * empty key segments are distinct keys.
 *
 * @module
 */

import * as kit from "@xtandard/kit/storage/file";

export {
  clearFileStorage,
  decodeSegment,
  encodeSegment,
  migrateFileStorage,
  type FileLegacyMode,
} from "@xtandard/kit/storage/file";

/**
 * Options for {@link createFileStorage}. `legacy` defaults to `"warn"`: leaves
 * in the v0.1.4 layout are ignored, and a warning pointing at
 * {@link migrateFileStorage} is printed once.
 */
export type FileStorageOptions = kit.FileStorageOptions;

/** A watchable, compare-and-swap capable file-backed storage. */
export type FileWebhooksStorage = kit.FileKvStorage;

/** The warning printed once when a store still has v0.1.4-layout files. */
const warnLegacy = (dir: string): void => {
  console.warn(
    `[@xtandard/webhooks] storage/file: ${dir} has files in the layout of v0.1.4 and earlier, ` +
      "which are ignored; run migrateFileStorage({ dir }) once to move them.",
  );
};

/**
 * Create a file-backed storage. `watch` is implemented via `fs.watch` on the
 * base directory (recursive); it is best-effort and may coalesce or miss events
 * on platforms without recursive-watch support.
 *
 * @example
 * ```ts
 * import { createFileStorage } from "@xtandard/webhooks/storage/file";
 *
 * const storage = createFileStorage({ dir: "./data/webhooks" });
 * ```
 */
export function createFileStorage(options: FileStorageOptions): FileWebhooksStorage {
  return kit.createFileStorage({ legacy: "warn", onLegacy: warnLegacy, ...options });
}
