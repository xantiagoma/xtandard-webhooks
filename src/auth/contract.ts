/**
 * Authentication contract. Answers: "Who is this request from?"
 *
 * `@xtandard/webhooks` ships `none`/`basic`/`delegated` implementations, but any
 * object satisfying {@link AuthProvider} works — bring your own.
 *
 * @module
 */

export type { AuthProvider, Principal } from "@xtandard/kit/auth";
