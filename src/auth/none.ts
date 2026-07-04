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

import type { AuthProvider, Principal } from "./contract.ts";

/** The fixed principal returned by {@link noAuth}. */
export const ANONYMOUS_PRINCIPAL: Principal = { id: "anonymous" };

/**
 * Create an {@link AuthProvider} that performs no authentication and resolves
 * every request to the shared {@link ANONYMOUS_PRINCIPAL}.
 *
 * Because it never returns `null`, the request is always "authenticated" — use
 * an {@link AuthorizationProvider} to control what the anonymous principal may
 * actually do.
 *
 * @example
 * ```ts
 * import { noAuth } from "@xtandard/webhooks/auth/none";
 *
 * const auth = noAuth();
 * await auth.authenticate(request); // → { id: "anonymous" }
 * ```
 */
export function noAuth(): AuthProvider {
  return {
    async authenticate(_request: Request): Promise<Principal | null> {
      return ANONYMOUS_PRINCIPAL;
    },
  };
}
