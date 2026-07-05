/**
 * UI-facing types. Entity shapes are re-exported from the package schema (types
 * only — safe to bundle); the UI adds the bootstrap config, API-error, and
 * wire-shape types the JSON admin API serves.
 */

export type {
  Application,
  AuditEntry,
  Delivery,
  DeliveryAttempt,
  DeliveryStatus,
  Endpoint,
  EndpointSecret,
  EventType,
  JsonValue,
  Message,
} from "../schema.ts";

import type { Delivery, DeliveryAttempt, Endpoint, Message } from "../schema.ts";

/** Bootstrap config injected as `window.__WEBHOOKS_CONFIG__` and served at `/config`. */
export interface WebhooksConfig {
  title: string;
  basePath: string;
  readonly: boolean;
  authenticated?: boolean;
  principal?: { id: string; email?: string; name?: string; roles?: string[] } | null;
  /** True when the request is scoped by a portal token — render the reduced chrome. */
  portal?: boolean;
  /** Logo image URL shown in the navbar in place of the title wordmark. */
  logoUrl?: string;
}

/** An endpoint as served by read routes: secrets stripped. */
export type EndpointSummary = Omit<Endpoint, "secrets">;

/** Message detail (`GET .../messages/:id`) includes its deliveries. */
export type MessageDetail = Message & { deliveries: Delivery[] };

/** Delivery detail (`GET .../deliveries/:id`) includes its attempt log. */
export type DeliveryDetail = Delivery & { attempts: DeliveryAttempt[] };

/**
 * The exact signed HTTP request a delivery attempt sends
 * (`GET .../deliveries/:id/request`). The signature and `webhook-timestamp`
 * reflect "now" — each attempt re-signs, so these change per attempt.
 */
export interface SignedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** `POST .../messages` result. */
export interface PublishResponse {
  message: Message;
  deliveries: Delivery[];
  deduplicated: boolean;
}

/** `POST .../endpoints/:id/test` result. */
export interface SendExampleResponse {
  outcome: { ok: boolean; httpStatus?: number; error?: string; durationMs: number };
  body: string;
  messageId: string;
}

/** `POST .../endpoints/:id/recover` result. */
export interface RecoverResponse {
  deliveryIds: string[];
}

export interface ApiError {
  status: number;
  error: string;
  code?: string;
  errors?: { path?: string; message: string }[];
}

export class WebhooksApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiError,
  ) {
    super(body.error);
    this.name = "WebhooksApiError";
  }
}
