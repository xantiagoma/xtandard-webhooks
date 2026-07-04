/**
 * Portal tokens — the credential behind the embeddable consumer portal.
 *
 * A portal token is a compact HMAC-signed grant scoping its bearer to exactly
 * **one application** for a limited time. The host mints tokens server-side
 * with {@link createPortalToken} (the portal secret never reaches a browser)
 * and hands them to its frontend; the panel handler verifies them with
 * {@link verifyPortalToken} and force-scopes authorization to the token's
 * application (see the `portal` panel option).
 *
 * Wire format:
 *
 * ```txt
 * whpt_<base64url(JSON { app, exp })>.<base64url(HMAC-SHA256(secret, payloadPart))>
 * ```
 *
 * Zero dependencies (Web Crypto only). Unlike Standard Webhooks signing
 * secrets, the portal secret is an **arbitrary string** — it is fed to the
 * HMAC as raw UTF-8 bytes, not base64-decoded.
 *
 * @module
 */

import { durationToMs } from "./duration.ts";
import type { WebhookDuration } from "./schema.ts";

/** Prefix of every portal token. */
export const PORTAL_TOKEN_PREFIX = "whpt_";

const DEFAULT_EXPIRES_IN: WebhookDuration = "7d";

/**
 * Thrown by {@link verifyPortalToken} for any invalid token — malformed,
 * bad signature, or expired. Maps to HTTP 401 at the API layer.
 */
export class PortalTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortalTokenError";
  }
}

/** Options for {@link createPortalToken}. */
export interface PortalTokenOptions {
  /** Token lifetime. Default `"7d"`. */
  expiresIn?: WebhookDuration;
}

/** The claims carried inside a portal token. */
interface PortalTokenClaims {
  /** The application the token grants access to. */
  app: string;
  /** Expiry, unix epoch milliseconds. */
  exp: number;
}

const base64urlEncode = (bytes: Uint8Array): string => {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const base64urlDecode = (value: string): Uint8Array => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/** HMAC-SHA256 keyed by the raw UTF-8 bytes of the (arbitrary-string) secret. */
async function hmac(secret: string, content: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(content));
  return new Uint8Array(digest);
}

/** Constant-time byte comparison (XOR accumulate — no early exit on content). */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

/**
 * Mint a portal token granting access to `applicationKey` until `expiresIn`
 * elapses (default 7 days). Call this **server-side** — anyone holding the
 * portal secret can mint tokens for any application.
 *
 * @example
 * ```ts
 * import { createPortalToken } from "@xtandard/webhooks";
 *
 * // In the host app's session-guarded route:
 * const token = await createPortalToken(process.env.PORTAL_SECRET!, "acme", {
 *   expiresIn: "1h",
 * });
 * // Hand `token` to the frontend for <WebhooksPortal token={token} />.
 * ```
 */
export async function createPortalToken(
  secret: string,
  applicationKey: string,
  options: PortalTokenOptions = {},
): Promise<string> {
  const expiresInMs = durationToMs(options.expiresIn ?? DEFAULT_EXPIRES_IN);
  const claims: PortalTokenClaims = { app: applicationKey, exp: Date.now() + expiresInMs };
  const payloadPart = base64urlEncode(new TextEncoder().encode(JSON.stringify(claims)));
  const signature = base64urlEncode(await hmac(secret, payloadPart));
  return `${PORTAL_TOKEN_PREFIX}${payloadPart}.${signature}`;
}

/**
 * Verify a portal token: format, signature (constant time), then expiry.
 * Returns the granted application key on success; throws
 * {@link PortalTokenError} otherwise.
 *
 * @example
 * ```ts
 * import { verifyPortalToken } from "@xtandard/webhooks";
 *
 * const { applicationKey } = await verifyPortalToken(secret, token);
 * ```
 */
export async function verifyPortalToken(
  secret: string,
  token: string,
): Promise<{ applicationKey: string }> {
  if (!token.startsWith(PORTAL_TOKEN_PREFIX)) {
    throw new PortalTokenError("Invalid portal token: missing whpt_ prefix");
  }
  const parts = token.slice(PORTAL_TOKEN_PREFIX.length).split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new PortalTokenError("Invalid portal token: malformed");
  }
  const [payloadPart, signaturePart] = parts as [string, string];

  // Signature first: never interpret unauthenticated claims.
  let candidate: Uint8Array;
  try {
    candidate = base64urlDecode(signaturePart);
  } catch {
    throw new PortalTokenError("Invalid portal token: malformed signature");
  }
  const expected = await hmac(secret, payloadPart);
  if (!timingSafeEqual(expected, candidate)) {
    throw new PortalTokenError("Invalid portal token: signature mismatch");
  }

  let claims: PortalTokenClaims;
  try {
    claims = JSON.parse(
      new TextDecoder().decode(base64urlDecode(payloadPart)),
    ) as PortalTokenClaims;
  } catch {
    throw new PortalTokenError("Invalid portal token: malformed payload");
  }
  if (typeof claims.app !== "string" || claims.app.length === 0) {
    throw new PortalTokenError("Invalid portal token: missing application");
  }
  if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp)) {
    throw new PortalTokenError("Invalid portal token: missing expiry");
  }
  if (Date.now() >= claims.exp) {
    throw new PortalTokenError("Portal token has expired");
  }
  return { applicationKey: claims.app };
}
