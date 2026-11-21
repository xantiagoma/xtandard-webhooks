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
 * HMAC as raw UTF-8 bytes, not base64-decoded. The mechanics are
 * `@xtandard/kit/tokens`; the `whpt_` prefix, the 7-day default lifetime and
 * the `{ app }` claim are the webhooks contract. An empty secret is rejected,
 * and `verifyPortalToken` accepts a list of secrets for rotation (the first
 * signs, any verifies).
 *
 * @module
 */

import { createScopedTokens, type TokenSecret } from "@xtandard/kit/tokens";
import type { WebhookDuration } from "./schema.ts";

/** Prefix of every portal token. */
export const PORTAL_TOKEN_PREFIX = "whpt_";

/** The portal token mechanics: `whpt_` prefix, 7-day default lifetime, `{ app }` claim. */
const portalTokens = createScopedTokens<{ app: string }>({
  prefix: PORTAL_TOKEN_PREFIX,
  ttl: "7d",
  label: "portal token",
  errorName: "PortalTokenError",
  validateClaims: (payload) => {
    if (typeof payload.app !== "string" || payload.app.length === 0) {
      throw new Error("missing application");
    }
    return { app: payload.app };
  },
});

/**
 * Thrown by {@link verifyPortalToken} for any invalid token — malformed,
 * bad signature, or expired. Maps to HTTP 401 at the API layer.
 */
export const PortalTokenError = portalTokens.TokenError;
/** An invalid portal token (see the {@link PortalTokenError} class). */
export type PortalTokenError = InstanceType<typeof PortalTokenError>;

/** Options for {@link createPortalToken}. */
export interface PortalTokenOptions {
  /** Token lifetime. Default `"7d"`. */
  expiresIn?: WebhookDuration;
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
  secret: TokenSecret,
  applicationKey: string,
  options: PortalTokenOptions = {},
): Promise<string> {
  return portalTokens.create(secret, { app: applicationKey }, { expiresIn: options.expiresIn });
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
  secret: TokenSecret,
  token: string,
): Promise<{ applicationKey: string }> {
  const { claims } = await portalTokens.verify(secret, token);
  return { applicationKey: claims.app };
}
