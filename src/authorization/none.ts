/**
 * The "no authorization" {@link AuthorizationProvider}. Every action is allowed.
 *
 * This grants unconditional access regardless of the principal (even `null`) or
 * the action/resource. It is the right choice for embedded usage and local
 * development where the admin API is not exposed to untrusted callers — commonly
 * paired with `noAuth()`.
 *
 * Do **not** use it for a network-exposed admin surface; reach for
 * `rolesAuthorization()` (or a delegated provider) instead.
 *
 * @module
 */

import type { AuthorizationProvider, AuthorizeInput } from "./contract.ts";

/**
 * Create an {@link AuthorizationProvider} that authorizes everything.
 *
 * @example
 * ```ts
 * import { noAuthorization } from "@xtandard/webhooks/authorization/none";
 *
 * const authz = noAuthorization();
 * await authz.authorize(input); // → true, always
 * ```
 */
export function noAuthorization(): AuthorizationProvider {
  return {
    async authorize(_input: AuthorizeInput): Promise<boolean> {
      return true;
    },
  };
}
