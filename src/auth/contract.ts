/**
 * Authentication contract. Answers: "Who is this request from?"
 *
 * `@xtandard/webhooks` ships `none`/`basic`/`delegated` implementations, but any
 * object satisfying {@link AuthProvider} works — bring your own.
 *
 * @module
 */

/** An authenticated identity. */
export interface Principal {
  id: string;
  email?: string;
  name?: string;
  roles?: string[];
  metadata?: unknown;
}

/** Authenticates an incoming web-standard {@link Request}. */
export interface AuthProvider {
  /** Resolve the principal, or `null` if the request is unauthenticated. */
  authenticate(request: Request): Promise<Principal | null>;
  /**
   * Optional: build a `Response` that prompts for credentials (e.g. a 401 with a
   * `WWW-Authenticate` header). When omitted, the server returns a plain 401.
   */
  challenge?(request: Request): Response | undefined;
}
