/**
 * Delegated {@link AuthProvider}. Wraps caller-supplied functions so you can
 * plug in any authentication scheme — JWT/bearer tokens, sessions, API keys,
 * OAuth, an existing middleware — without implementing the {@link AuthProvider}
 * interface by hand.
 *
 * The wrapper normalizes a synchronous-or-asynchronous `authenticate` into the
 * `Promise`-returning shape the contract requires, and forwards an optional
 * `challenge`.
 *
 * @module
 */

export { delegatedAuth, type DelegatedAuthOptions } from "@xtandard/kit/auth/delegated";
