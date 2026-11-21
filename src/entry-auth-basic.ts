/**
 * HTTP Basic authentication for the panel: `basicAuth()` checks the
 * `Authorization: Basic` header against a configured user list (scrypt
 * password hashes via `hashPassword`, a custom verifier, or plaintext for
 * development only).
 *
 * Import from `@xtandard/webhooks/auth/basic`.
 *
 * @module auth/basic
 */

export * from "./auth/basic.ts";
