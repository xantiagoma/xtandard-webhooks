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

import type { AuthProvider, Principal } from "./contract.ts";

/** Options for {@link delegatedAuth}. */
export interface DelegatedAuthOptions {
  /**
   * Resolve the {@link Principal} for a request, or `null` if unauthenticated.
   * May be synchronous or asynchronous.
   */
  authenticate: (request: Request) => Promise<Principal | null> | Principal | null;
  /**
   * Optional challenge builder, mirroring {@link AuthProvider.challenge}. Return
   * a `Response` (typically a `401`) to prompt for credentials, or `undefined`
   * to fall back to the server's default.
   */
  challenge?: (request: Request) => Response | undefined;
}

/**
 * Create an {@link AuthProvider} from plain functions.
 *
 * @example
 * ```ts
 * import { delegatedAuth } from "@xtandard/webhooks/auth/delegated";
 *
 * const auth = delegatedAuth({
 *   authenticate: async (request) => {
 *     const token = request.headers.get("authorization")?.replace("Bearer ", "");
 *     return token ? await verifyToken(token) : null;
 *   },
 * });
 * ```
 */
export function delegatedAuth(options: DelegatedAuthOptions): AuthProvider {
  const provider: AuthProvider = {
    async authenticate(request: Request): Promise<Principal | null> {
      return await options.authenticate(request);
    },
  };
  if (options.challenge) {
    provider.challenge = options.challenge;
  }
  return provider;
}
