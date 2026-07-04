/**
 * Receiver-side verification helpers — `@xtandard/webhooks/receiver`.
 *
 * Zero dependencies, works in any WinterCG runtime (Bun, Node ≥ 20, Deno,
 * Workers). Verifies webhooks from **any** Standard Webhooks-compliant sender
 * — this package, Svix, or anything else that follows the spec — so it is
 * useful even if the sending side isn't `@xtandard/webhooks`.
 *
 * @module
 */

import type { WebhookEnvelope } from "./schema.ts";
import { verify, WebhookVerificationError } from "./signing.ts";

export { verify, WebhookVerificationError };
export type { WebhookEnvelope };
export type { VerifyInput } from "./signing.ts";

/** Options for {@link verifyWebhook}. */
export interface VerifyWebhookOptions {
  /** Allowed clock skew in seconds, both past and future. Default `300`. */
  toleranceSeconds?: number;
  /** Current unix time in seconds — injectable for tests. */
  now?: number;
}

/**
 * Verify an incoming `Request`: reads the raw body, checks the Standard
 * Webhooks headers and signature(s), and returns the parsed envelope. Throws
 * {@link WebhookVerificationError} on any failure.
 *
 * @example
 * ```ts
 * import { verifyWebhook } from "@xtandard/webhooks/receiver";
 *
 * // In any fetch-style handler:
 * async function handler(request: Request): Promise<Response> {
 *   try {
 *     const event = await verifyWebhook(request, process.env.WEBHOOK_SECRET!);
 *     console.log(event.type, event.data);
 *     return new Response("ok");
 *   } catch {
 *     return new Response("invalid signature", { status: 401 });
 *   }
 * }
 * ```
 */
export async function verifyWebhook(
  request: Request,
  secret: string | string[],
  options: VerifyWebhookOptions = {},
): Promise<WebhookEnvelope> {
  const payload = await request.text();
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return verify({ payload, headers, secret, ...options });
}
