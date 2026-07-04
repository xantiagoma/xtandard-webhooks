/**
 * Delivery sink — a **delivery-plane** observation tap, fired once per attempt.
 * Deliberately separate from the admin-plane {@link ./hooks/contract.WebhooksHooks}
 * (`before`/`after` around control-plane mutations):
 *
 * - **Different plane.** Admin hooks live around rare, human-driven mutations
 *   (endpoints, event types, replay). Attempts happen inside the dispatcher,
 *   potentially thousands per minute.
 * - **Hot path.** The sink is **fire-and-forget**: invoked *after* the attempt
 *   is recorded, never awaited, and its errors never propagate into the
 *   delivery loop.
 *
 * It exists to feed metrics/observability pipelines — Prometheus counters,
 * per-endpoint success dashboards, usage-based stale-endpoint detection —
 * without a stats engine. The `after` hooks only see **terminal** transitions
 * (`delivery.succeeded` / `delivery.exhausted`); the sink sees every attempt.
 *
 * @module
 */

import type { AttemptTrigger } from "./schema.ts";

/** One recorded delivery attempt, delivered to a {@link DeliveryListener}. */
export interface DeliveryEvent {
  applicationKey: string;
  endpointId: string;
  messageId: string;
  deliveryId: string;
  /** The message's event type name. */
  eventType: string;
  /** 1-based attempt ordinal within the delivery. */
  attemptNumber: number;
  /** True when the receiver answered 2xx. */
  ok: boolean;
  /** True when this attempt drove the delivery to a terminal state. */
  terminal: boolean;
  /** HTTP status code; absent on network error/timeout. */
  httpStatus?: number;
  /** Wall-clock duration of the HTTP round trip. */
  durationMs: number;
  /** What initiated the attempt. */
  trigger: AttemptTrigger;
  /** ISO-8601 timestamp of the attempt. */
  at: string;
}

/**
 * A fire-and-forget observer of delivery attempts. Return value (including a
 * Promise) is ignored by the caller; throwing / rejecting never affects the
 * delivery — failures are routed to the configured error reporter.
 */
export type DeliveryListener = (event: DeliveryEvent) => void | Promise<void>;

/** Reports an error thrown/rejected by a {@link DeliveryListener}. */
export type DeliveryErrorReporter = (error: unknown, event: DeliveryEvent) => void;

/**
 * Invoke `listener` safely off the delivery path: synchronous throws are caught
 * and a returned Promise's rejection is handled, so a broken sink can never
 * fail (or slow, since it is not awaited) a delivery.
 */
export function emitDelivery(
  listener: DeliveryListener,
  event: DeliveryEvent,
  onError?: DeliveryErrorReporter,
): void {
  try {
    const result = listener(event);
    if (result && typeof (result as Promise<void>).then === "function") {
      (result as Promise<void>).catch((error) => onError?.(error, event));
    }
  } catch (error) {
    onError?.(error, event);
  }
}
