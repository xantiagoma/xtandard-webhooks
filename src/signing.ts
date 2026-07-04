/**
 * Standard Webhooks symmetric (v1) signing and verification.
 *
 * Pure and zero-dependency (Web Crypto only) — safe on the request path and in
 * any WinterCG runtime. Shared by the sender (the dispatcher signs outgoing
 * deliveries) and the receiver subpath (`@xtandard/webhooks/receiver`), and
 * compatible with any Standard Webhooks implementation, including Svix.
 *
 * The wire contract (https://www.standardwebhooks.com):
 *
 * - secrets are `whsec_` + base64-encoded key material (24–64 bytes decoded)
 * - the signed content is `${id}.${timestamp}.${body}`
 * - the signature is `v1,` + base64(HMAC-SHA256(key, signedContent))
 * - `webhook-signature` may carry several space-separated signatures (secret
 *   rotation); a receiver accepts if **any** matches
 * - `webhook-timestamp` (unix seconds) must be within tolerance, both ways
 *
 * @module
 */

import type { WebhookEnvelope } from "./schema.ts";

export type { WebhookEnvelope };

/** Prefix of every symmetric Standard Webhooks secret. */
export const SECRET_PREFIX = "whsec_";

/** Prefix of every symmetric (v1) signature entry. */
const SIGNATURE_VERSION = "v1";

const MIN_SECRET_BYTES = 24;
const MAX_SECRET_BYTES = 64;

/** Thrown by {@link verify} / receiver helpers when a webhook fails verification. */
export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64Decode(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Decode `whsec_…` into raw key bytes, enforcing the spec's 24–64 byte range. */
function decodeSecret(secret: string): Uint8Array {
  const body = secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret;
  let bytes: Uint8Array;
  try {
    bytes = base64Decode(body);
  } catch {
    throw new WebhookVerificationError("Invalid secret: not base64");
  }
  if (bytes.length < MIN_SECRET_BYTES || bytes.length > MAX_SECRET_BYTES) {
    throw new WebhookVerificationError(
      `Invalid secret: decoded length ${bytes.length} outside ${MIN_SECRET_BYTES}–${MAX_SECRET_BYTES} bytes`,
    );
  }
  return bytes;
}

/**
 * Generate a new signing secret: `whsec_` + base64 of 24 crypto-random bytes.
 *
 * @example
 * ```ts
 * import { generateSecret } from "@xtandard/webhooks/signing";
 *
 * const secret = generateSecret(); // "whsec_…"
 * ```
 */
export function generateSecret(): string {
  const bytes = new Uint8Array(MIN_SECRET_BYTES);
  crypto.getRandomValues(bytes);
  return SECRET_PREFIX + base64Encode(bytes);
}

async function hmacSha256(keyBytes: Uint8Array, content: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(content));
  return new Uint8Array(digest);
}

/**
 * Sign one delivery attempt with one secret: `v1,` + base64(HMAC-SHA256 over
 * `${id}.${timestamp}.${body}`). `timestamp` is unix **seconds**.
 *
 * @example
 * ```ts
 * import { sign } from "@xtandard/webhooks/signing";
 *
 * const signature = await sign(secret, "msg_…", 1720000000, body);
 * // "v1,K5oZ…"
 * ```
 */
export async function sign(
  secret: string,
  id: string,
  timestamp: number,
  body: string,
): Promise<string> {
  const digest = await hmacSha256(decodeSecret(secret), `${id}.${timestamp}.${body}`);
  return `${SIGNATURE_VERSION},${base64Encode(digest)}`;
}

/**
 * Build the full `webhook-signature` header value: one signature per secret,
 * space-separated (multiple entries appear during secret rotation).
 */
export async function signatureHeader(
  secrets: string[],
  id: string,
  timestamp: number,
  body: string,
): Promise<string> {
  const signatures = await Promise.all(secrets.map((s) => sign(s, id, timestamp, body)));
  return signatures.join(" ");
}

/** Constant-time byte comparison (XOR accumulate — no early exit on content). */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

/** Case-insensitive header lookup in a plain record. */
function headerLookup(headers: Record<string, string>, name: string): string | undefined {
  const direct = headers[name];
  if (direct !== undefined) return direct;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

/** Input to {@link verify}. */
export interface VerifyInput {
  /** The raw request body, **exactly** as received (no re-serialization). */
  payload: string;
  /** Request headers; name lookup is case-insensitive. */
  headers: Record<string, string>;
  /** Candidate secret(s) — pass several during rotation; any match passes. */
  secret: string | string[];
  /** Allowed clock skew in seconds, both past and future. Default `300`. */
  toleranceSeconds?: number;
  /** Current unix time in seconds — injectable for tests. */
  now?: number;
}

/**
 * Verify an incoming Standard Webhooks request (from **any** compliant sender,
 * not just this package). Checks the timestamp tolerance, then compares every
 * `v1,` signature in the header against every candidate secret in constant
 * time. Returns the parsed envelope on success; throws
 * {@link WebhookVerificationError} otherwise.
 *
 * @example
 * ```ts
 * import { verify } from "@xtandard/webhooks/signing";
 *
 * const envelope = await verify({
 *   payload: rawBody,
 *   headers: { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": sig },
 *   secret: "whsec_…",
 * });
 * ```
 */
export async function verify(input: VerifyInput): Promise<WebhookEnvelope> {
  const id = headerLookup(input.headers, "webhook-id");
  const timestampRaw = headerLookup(input.headers, "webhook-timestamp");
  const signatureHeaderValue = headerLookup(input.headers, "webhook-signature");
  if (!id) throw new WebhookVerificationError("Missing webhook-id header");
  if (!timestampRaw) throw new WebhookVerificationError("Missing webhook-timestamp header");
  if (!signatureHeaderValue) throw new WebhookVerificationError("Missing webhook-signature header");

  const timestamp = Number(timestampRaw);
  if (!Number.isFinite(timestamp) || !/^\d+$/.test(timestampRaw.trim())) {
    throw new WebhookVerificationError(`Invalid webhook-timestamp "${timestampRaw}"`);
  }
  const tolerance = input.toleranceSeconds ?? 300;
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (timestamp < now - tolerance) {
    throw new WebhookVerificationError("webhook-timestamp is too old");
  }
  if (timestamp > now + tolerance) {
    throw new WebhookVerificationError("webhook-timestamp is in the future");
  }

  // Only v1 (symmetric) entries participate; other versions are skipped.
  const candidates = signatureHeaderValue
    .split(" ")
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith(`${SIGNATURE_VERSION},`))
    .map((entry) => entry.slice(SIGNATURE_VERSION.length + 1));
  if (candidates.length === 0) {
    throw new WebhookVerificationError("No v1 signature found in webhook-signature header");
  }

  const secrets = Array.isArray(input.secret) ? input.secret : [input.secret];
  if (secrets.length === 0) throw new WebhookVerificationError("No secret provided");

  const content = `${id}.${timestamp}.${input.payload}`;
  let matched = false;
  for (const secret of secrets) {
    const expected = await hmacSha256(decodeSecret(secret), content);
    for (const candidate of candidates) {
      let candidateBytes: Uint8Array;
      try {
        candidateBytes = base64Decode(candidate);
      } catch {
        continue; // malformed entry — try the rest
      }
      if (timingSafeEqual(expected, candidateBytes)) matched = true;
    }
  }
  if (!matched) throw new WebhookVerificationError("No matching signature");

  try {
    return JSON.parse(input.payload) as WebhookEnvelope;
  } catch {
    throw new WebhookVerificationError("Payload is not valid JSON");
  }
}
