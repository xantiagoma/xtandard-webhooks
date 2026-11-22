/**
 * Delegated {@link AuthorizationProvider}. Wraps a caller-supplied `authorize`
 * function so you can implement any policy — ABAC, an external policy engine
 * (OPA, Cedar), per-application ownership checks — without implementing the
 * interface by hand.
 *
 * The wrapper normalizes a synchronous-or-asynchronous decision into the
 * `Promise<boolean>` the contract requires.
 *
 * @module
 */

import { delegatedAuthorization as kitDelegated } from "@xtandard/kit/authorization/delegated";
import type { AuthorizationProvider, AuthorizeInput } from "./contract.ts";

/** Options for {@link delegatedAuthorization}. */
export interface DelegatedAuthorizationOptions {
  /** Decide whether to allow the action. May be sync or async. */
  authorize: (input: AuthorizeInput) => Promise<boolean> | boolean;
}

/** Create an {@link AuthorizationProvider} from your own `authorize` function. */
export function delegatedAuthorization(
  options: DelegatedAuthorizationOptions,
): AuthorizationProvider {
  return kitDelegated(options);
}
