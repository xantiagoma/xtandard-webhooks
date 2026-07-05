/**
 * Canonical JSON serialization: object keys sorted recursively, so two values
 * that are structurally equal produce byte-identical output regardless of key
 * insertion order.
 *
 * Used for the idempotency comparison in {@link ./core.WebhooksCore.publish}:
 * some control-plane stores canonicalize object key order on round-trip
 * (Postgres `jsonb`, some BSON paths), so a stored payload read back may have a
 * different key order than the freshly-published one. An order-sensitive
 * comparison would then flag an identical re-publish as an
 * `IdempotencyConflictError`. Comparing canonical forms fixes it uniformly,
 * independent of the storage adapter.
 *
 * @module
 */

import type { JsonValue } from "./schema.ts";

/**
 * Serialize a JSON value with object keys sorted lexicographically at every
 * depth. Arrays keep their order (order is semantic for arrays); `undefined`
 * inside objects is dropped exactly as `JSON.stringify` would.
 *
 * @example
 * ```ts
 * canonicalStringify({ b: 1, a: 2 }) === canonicalStringify({ a: 2, b: 1 }); // true
 * ```
 */
export function canonicalStringify(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  const entries = keys
    .filter((k) => value[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k] as JsonValue)}`);
  return `{${entries.join(",")}}`;
}
