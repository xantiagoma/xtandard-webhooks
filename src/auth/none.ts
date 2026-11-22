/**
 * The "no authentication" {@link AuthProvider}. Treats every request as a single
 * anonymous principal.
 *
 * This does **not** mean "reject everyone" — it means the server performs no
 * credential checks at all. A fixed `{ id: "anonymous" }` principal is returned
 * for every request so that downstream {@link AuthorizationProvider authorization}
 * can still run (and, for example, deny mutating actions in readonly mode).
 *
 * Suitable for embedded usage, local development, or deployments fronted by an
 * external auth layer (a gateway, mTLS, a VPN, etc.). Pair it with
 * `noAuthorization()` to allow everything, or with `rolesAuthorization()` to
 * still gate actions.
 *
 * @module
 */

export { ANONYMOUS_PRINCIPAL, noAuth } from "@xtandard/kit/auth/none";
