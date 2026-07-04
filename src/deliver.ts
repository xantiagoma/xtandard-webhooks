/**
 * The single-attempt HTTP delivery primitive: build the Standard Webhooks
 * headers, POST the envelope, capture the outcome. Owns no retry/queue logic —
 * the dispatcher schedules attempts and `core.sendExample` fires one-off test
 * sends through the same code path so test deliveries are wire-identical to
 * real ones.
 *
 * @module
 */

import type { Endpoint } from "./schema.ts";
import { signatureHeader } from "./signing.ts";

/** Default cap on how many response-body characters are kept per attempt. */
export const DEFAULT_RESPONSE_BODY_LIMIT = 4096;

/** Default per-attempt timeout. */
export const DEFAULT_ATTEMPT_TIMEOUT_MS = 20_000;

/** Input to {@link attemptDelivery}. */
export interface AttemptDeliveryInput {
  endpoint: Endpoint;
  /** The `webhook-id` header — the **message** id (stable across retries). */
  messageId: string;
  /** The serialized envelope body, exactly as stored at publish time. */
  body: string;
  /** Per-attempt timeout (AbortController). Default 20s. */
  timeoutMs?: number;
  /** Cap on stored response-body characters. Default 4096. */
  responseBodyLimit?: number;
  /** `user-agent` header value. */
  userAgent?: string;
  /** Injectable fetch (tests, instrumentation). Default: global fetch. */
  fetch?: typeof fetch;
  /** Unix millis of the attempt; defaults to `Date.now()`. */
  nowMs?: number;
}

/** The observed outcome of one HTTP delivery attempt. */
export interface AttemptOutcome {
  ok: boolean;
  httpStatus?: number;
  /** Truncated error message on network error/timeout. */
  error?: string;
  /** Truncated response body. */
  responseBody?: string;
  durationMs: number;
  /** ISO-8601 timestamp of the attempt. */
  at: string;
}

/** The endpoint's currently-signing secrets: the active one + unexpired rotation grace. */
export function activeSecrets(endpoint: Endpoint, nowMs: number): string[] {
  return endpoint.secrets
    .filter((s) => !s.expiresAt || Date.parse(s.expiresAt) > nowMs)
    .map((s) => s.secret);
}

const truncate = (value: string, limit: number): string =>
  value.length > limit ? value.slice(0, limit) : value;

/**
 * Perform one signed POST to `endpoint.url`. Never throws for remote-party
 * failures — network errors, timeouts, and non-2xx responses all come back as
 * a failed {@link AttemptOutcome}. (It does throw on programmer error, e.g. an
 * endpoint with no unexpired secret.)
 */
export async function attemptDelivery(input: AttemptDeliveryInput): Promise<AttemptOutcome> {
  const nowMs = input.nowMs ?? Date.now();
  const at = new Date(nowMs).toISOString();
  const timeoutMs = input.timeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
  const bodyLimit = input.responseBodyLimit ?? DEFAULT_RESPONSE_BODY_LIMIT;
  const doFetch = input.fetch ?? fetch;

  const secrets = activeSecrets(input.endpoint, nowMs);
  if (secrets.length === 0) {
    throw new Error(`Endpoint ${input.endpoint.id} has no unexpired signing secret`);
  }

  // The timestamp is of THIS attempt (receivers check tolerance against it);
  // the id is the message id, stable across retries (receivers dedupe on it).
  const timestamp = Math.floor(nowMs / 1000);
  const signature = await signatureHeader(secrets, input.messageId, timestamp, input.body);

  const headers: Record<string, string> = {
    ...input.endpoint.headers,
    "content-type": "application/json",
    "webhook-id": input.messageId,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": signature,
  };
  if (input.userAgent) headers["user-agent"] = input.userAgent;

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Node/Bun timers keep the process alive by default; an in-flight attempt
  // should not.
  (timer as { unref?: () => void }).unref?.();

  try {
    const response = await doFetch(input.endpoint.url, {
      method: "POST",
      headers,
      body: input.body,
      signal: controller.signal,
      redirect: "manual", // a redirect is not a delivery — receivers must answer 2xx directly
    });
    let responseBody = "";
    try {
      responseBody = truncate(await response.text(), bodyLimit);
    } catch {
      // Body read failures (aborted stream, etc.) don't change the verdict.
    }
    return {
      ok: response.status >= 200 && response.status < 300,
      httpStatus: response.status,
      responseBody: responseBody || undefined,
      durationMs: Date.now() - started,
      at,
    };
  } catch (error) {
    const aborted = controller.signal.aborted;
    const message = aborted
      ? `Timed out after ${timeoutMs}ms`
      : error instanceof Error
        ? error.message
        : String(error);
    return {
      ok: false,
      error: truncate(message, 512),
      durationMs: Date.now() - started,
      at,
    };
  } finally {
    clearTimeout(timer);
  }
}
