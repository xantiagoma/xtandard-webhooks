/**
 * HTTP Basic authentication {@link AuthProvider}.
 *
 * Parses the `Authorization: Basic <base64>` header, looks the username up in a
 * configured user list, and verifies the supplied password using one of three
 * credential modes (in order of preference):
 *
 * 1. A custom `passwordVerifier(username, password)` callback — for delegating
 *    to your own user store.
 * 2. A `passwordHash` produced by {@link hashPassword} — scrypt with a random
 *    salt, verified in constant time. **Recommended for production.**
 * 3. A plain `password` field — **development only**. Never ship real
 *    credentials as plaintext; they are compared in constant time but stored as
 *    cleartext in your config.
 *
 * On success the matched user becomes a {@link Principal}; on any failure
 * (missing/malformed header, unknown user, bad password) `authenticate` returns
 * `null`. {@link AuthProvider.challenge} emits a `401` with a
 * `WWW-Authenticate: Basic realm="…"` header so browsers prompt for credentials.
 *
 * Password hashing uses Node's `node:crypto` `scrypt`, which is available in
 * both Node and Bun — no Bun-only APIs and no extra dependencies.
 *
 * @module
 */

import * as kit from "@xtandard/kit/auth/basic";
import type { AuthProvider } from "@xtandard/kit/auth";

export { hashPassword, verifyPassword, type BasicAuthUser } from "@xtandard/kit/auth/basic";

/** Options for {@link basicAuth}. `realm` defaults to `"xtandard-webhooks"`. */
export type BasicAuthOptions = kit.BasicAuthOptions;

/**
 * Create an HTTP Basic {@link AuthProvider}. Unauthenticated requests get a
 * `WWW-Authenticate: Basic realm="xtandard-webhooks"` challenge (or your `realm`).
 *
 * @example
 * ```ts
 * import { basicAuth, hashPassword } from "@xtandard/webhooks/auth/basic";
 *
 * const auth = basicAuth({
 *   realm: "Webhooks Admin",
 *   users: [{ username: "ops", passwordHash: await hashPassword("s3cret"), roles: ["admin"] }],
 * });
 * ```
 */
export function basicAuth(options: BasicAuthOptions): AuthProvider {
  return kit.basicAuth({ ...options, realm: options.realm ?? "xtandard-webhooks" });
}
