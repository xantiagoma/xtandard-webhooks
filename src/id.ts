/**
 * Entity id generation: `{prefix}_{22-char base62}`. Zero dependencies — base62
 * over `crypto.getRandomValues`, no ULID. 22 base62 characters encode ~131 bits;
 * ids are generated from 16 random bytes (128 bits) and left-padded to a fixed
 * length so ids are uniform and lexicographically well-behaved.
 *
 * @module
 */

/** Prefixes for the four generated entity id kinds. */
export type IdPrefix = "msg" | "ep" | "dlv" | "atp";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ID_LENGTH = 22;
const RANDOM_BYTES = 16;

/** Encode 128 random bits as a fixed-length 22-char base62 string. */
function randomBase62(): string {
  const bytes = new Uint8Array(RANDOM_BYTES);
  crypto.getRandomValues(bytes);
  let value = 0n;
  for (const b of bytes) value = (value << 8n) | BigInt(b);
  let out = "";
  while (value > 0n) {
    out = ALPHABET[Number(value % 62n)] + out;
    value /= 62n;
  }
  return out.padStart(ID_LENGTH, "0");
}

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
  return `${prefix}_${randomBase62()}`;
}

/** Regex an id of the given prefix must match. */
export function idPattern(prefix: IdPrefix): RegExp {
  return new RegExp(`^${prefix}_[0-9A-Za-z]{${ID_LENGTH}}$`);
}
