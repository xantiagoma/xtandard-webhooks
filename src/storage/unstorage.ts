/**
 * Adapter that wraps an [unstorage](https://unstorage.unjs.io) `Storage`
 * instance as a {@link WebhooksStorage}. The caller constructs and configures
 * their own unstorage instance (with whatever driver they like) and passes it in
 * — we never import `unstorage` at runtime, only its type. `unstorage` therefore
 * remains an optional peer dependency.
 *
 * The driver is `@xtandard/kit/storage/unstorage`: it escapes the characters
 * unstorage normalizes away (`%`, `?`, `\`, `:`, a trailing `$`, empty segments)
 * so every key round-trips exactly, and reads keys written by earlier releases.
 * Filesystem-backed unstorage drivers inherit their filesystem's case
 * sensitivity; prefer `storage/file`, which encodes case.
 *
 * @module
 */

export {
  createUnstorageStorage,
  type UnstorageStorageOptions,
} from "@xtandard/kit/storage/unstorage";
