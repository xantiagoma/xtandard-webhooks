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

import { noAuthorization as kitNoAuthorization } from "@xtandard/kit/authorization/none";
import type { AuthorizationProvider } from "./contract.ts";

/** Create an {@link AuthorizationProvider} that allows every action. */
export function noAuthorization(): AuthorizationProvider {
  return kitNoAuthorization();
}
