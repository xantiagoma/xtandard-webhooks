/**
 * Entity id generation: `{prefix}_{22-char base62}`. Zero dependencies — base62
 * over `crypto.getRandomValues`, no ULID. 22 base62 characters encode ~131 bits;
 * ids are generated from 16 random bytes (128 bits) and left-padded to a fixed
 * length so ids are uniform and lexicographically well-behaved.
 *
 * @module
 */

import { createIdGenerator } from "@xtandard/kit/util";

/** Prefixes for the four generated entity id kinds. */
export type IdPrefix = "msg" | "ep" | "dlv" | "atp";

/** The persisted id format: random base62 (ADR 0005 — ids are stored data). */
const ids = createIdGenerator<IdPrefix>({
  format: "base62",
  prefixes: ["msg", "ep", "dlv", "atp"],
});

/**
 * Generate a new entity id, e.g. `newId("msg")` → `"msg_0uK9…"` (22-char base62
 * suffix).
 *
 * @example
 * ```ts
 * import { newId } from "@xtandard/webhooks";
 *
 * const id = newId("ep"); // "ep_…"
 * ```
 */
export function newId(prefix: IdPrefix): string {
  return ids.newId(prefix);
}

/** Regex an id of the given prefix must match. */
export function idPattern(prefix: IdPrefix): RegExp {
  return ids.idPattern(prefix);
}
