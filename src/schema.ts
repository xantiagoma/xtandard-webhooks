/**
 * Core type definitions for `@xtandard/webhooks`.
 *
 * This module is **types only** — no runtime code beyond tiny guards and the
 * schema-version constant, no dependencies. It is safe to import from the
 * publish hot path and the receiver. Runtime validation (which pulls in
 * `valibot`) lives in {@link ./validation}.
 *
 * @module
 */

/** JSON-serializable value, used for payloads, metadata, and event-type schemas. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * A duration for configuration options: either milliseconds as a number, or a
 * human-friendly string such as `"5s"`, `"30m"`, `"2h"`, `"5d"`. Parsed by
 * {@link ./duration.durationToMs}.
 */
export type WebhookDuration = number | `${number}${"ms" | "s" | "m" | "h" | "d"}`;

/** Identity captured on audit records and passed by callers of audited mutations. */
export interface Actor {
  id: string;
  email?: string;
  name?: string;
}

/** Current schema version for stored records. */
export const SCHEMA_VERSION = 1 as const;

/**
 * An application is the unit of tenancy — typically one of *your* customers.
 * Endpoints, messages, and deliveries are all scoped to an application, and a
 * portal token grants access to exactly one application.
 */
export interface Application {
  /** Unique key. Allowed characters: `a-z A-Z 0-9 . _ -`. */
  key: string;
  /** Optional human-friendly name shown in the UI. */
  name?: string;
  /** Arbitrary host-defined metadata. */
  metadata?: JsonValue;
  /** ISO-8601 creation timestamp, server-stamped. */
  createdAt?: string;
  /** ISO-8601 last-update timestamp, server-stamped. */
  updatedAt?: string;
}

/**
 * A named kind of event in the **global** catalog (shared by all applications),
 * e.g. `"invoice.paid"`. Endpoints subscribe to event types by name.
 */
export interface EventType {
  /** Unique dot-delimited name, e.g. `"invoice.paid"`. Allowed: `a-z A-Z 0-9 . _ -`. */
  name: string;
  /** Optional description shown in the UI and the public catalog. */
  description?: string;
  /** Optional UI grouping label (e.g. `"Billing"`). Purely presentational. */
  groupName?: string;
  /**
   * Optional JSON Schema describing the payload. Documentation by default;
   * enforced only when the core is configured with a `payloadValidator`.
   */
  schema?: JsonValue;
  /** Deprecated event types are flagged in the UI but still deliverable. */
  deprecated?: boolean;
  /** ISO-8601 creation timestamp, server-stamped. */
  createdAt?: string;
  /** ISO-8601 last-update timestamp, server-stamped. */
  updatedAt?: string;
}

/**
 * A signing secret attached to an endpoint. Secrets are `whsec_` + base64 per
 * the Standard Webhooks spec. Rotation keeps the previous secret verifiable
 * until `expiresAt` (the grace window); expired secrets are pruned lazily.
 */
export interface EndpointSecret {
  /** `"whsec_"` + base64-encoded random key material. */
  secret: string;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** Set when superseded by rotation; the secret stops signing after this instant. */
  expiresAt?: string;
}

/** Why an endpoint is disabled: by an operator, or by the auto-disable policy. */
export type EndpointDisabledReason = "manual" | "auto";

/**
 * A customer-registered URL that receives deliveries for one application.
 */
export interface Endpoint {
  /** `"ep_"` + 22-char base62, server-generated. */
  id: string;
  /** Destination URL. `https` is enforced by default (`allowInsecureUrls` for dev). */
  url: string;
  /** Optional description shown in the UI. */
  description?: string;
  /**
   * Event type names this endpoint subscribes to. Empty or absent = receives
   * **all** event types.
   */
  eventTypes?: string[];
  /** Disabled endpoints receive no deliveries (pending ones are held, not failed). */
  disabled?: boolean;
  /** Who/what disabled it — an operator (`"manual"`) or the failure policy (`"auto"`). */
  disabledReason?: EndpointDisabledReason;
  /** Static extra headers merged into every delivery request. */
  headers?: Record<string, string>;
  /** Signing secrets. `[0]` is current; extras are still-verifiable rotation grace. */
  secrets: EndpointSecret[];
  /** Arbitrary host-defined metadata. */
  metadata?: JsonValue;
  /** ISO-8601 creation timestamp, server-stamped. */
  createdAt?: string;
  /** ISO-8601 last-update timestamp, server-stamped. */
  updatedAt?: string;
  /**
   * Start of the current unbroken failure streak (any successful delivery
   * clears it). Drives the auto-disable policy.
   */
  firstFailingAt?: string | null;
}

/**
 * A published event for one application. The message is the receiver-facing
 * unit: its id is the `webhook-id` header (stable across retries — receivers
 * dedupe on it), and its payload is the `data` of the wire envelope.
 */
export interface Message {
  /** `"msg_"` + 22-char base62, server-generated. Sent as `webhook-id`. */
  id: string;
  /** Event type name (usually from the global catalog). */
  eventType: string;
  /** The `data` of the wire envelope. */
  payload: JsonValue;
  /** ISO-8601 event-occurred time (defaults to publish time). Sent in the envelope. */
  timestamp: string;
  /** Optional caller-supplied dedupe key; same key within retention returns the same message. */
  idempotencyKey?: string;
  /**
   * The wire envelope serialized **once at publish time** so the signed bytes
   * are identical across every retry of every delivery.
   */
  envelope: string;
  /** ISO-8601 creation timestamp, server-stamped. */
  createdAt: string;
}

/**
 * Delivery lifecycle. `"failed"` means the retry schedule is exhausted — the
 * dead-letter state. A manual retry moves a failed delivery back to `"pending"`.
 */
export type DeliveryStatus = "pending" | "delivering" | "succeeded" | "failed";

/** Guard: has this delivery reached a terminal state? */
export function isTerminalDeliveryStatus(status: DeliveryStatus): boolean {
  return status === "succeeded" || status === "failed";
}

/**
 * One message × one endpoint. Created at publish time (fan-out) and driven to
 * a terminal state by the dispatcher.
 */
export interface Delivery {
  /** `"dlv_"` + 22-char base62, server-generated. */
  id: string;
  /** The application this delivery belongs to (deliveries cross the dispatcher denormalized). */
  applicationKey: string;
  messageId: string;
  endpointId: string;
  status: DeliveryStatus;
  /** Number of attempts made so far. */
  attemptCount: number;
  /** When the next attempt is due. `null` once terminal. */
  nextAttemptAt?: string | null;
  /** Dispatcher claim expiry; an expired lease makes the delivery reclaimable. */
  leaseUntil?: string | null;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** ISO-8601 last-transition timestamp. */
  updatedAt: string;
}

/** What initiated a delivery attempt. */
export type AttemptTrigger = "schedule" | "manual" | "test";

/** The recorded outcome of a single HTTP delivery attempt. */
export interface DeliveryAttempt {
  /** `"atp_"` + 22-char base62, server-generated. */
  id: string;
  deliveryId: string;
  /** 1-based attempt ordinal within the delivery. */
  attemptNumber: number;
  /** ISO-8601 timestamp of the attempt. */
  at: string;
  /** Wall-clock duration of the HTTP round trip. */
  durationMs: number;
  /** True when the receiver answered 2xx. */
  ok: boolean;
  /** HTTP status code; absent on network error or timeout. */
  httpStatus?: number;
  /** Truncated error message on network error/timeout. */
  error?: string;
  /** Truncated response body (default cap 4096 chars). */
  responseBody?: string;
  /** What initiated this attempt. */
  trigger: AttemptTrigger;
}

/** Actions recorded in the control-plane audit log. */
export type AuditAction =
  | "application.create"
  | "application.update"
  | "application.delete"
  | "event-type.create"
  | "event-type.update"
  | "event-type.delete"
  | "endpoint.create"
  | "endpoint.update"
  | "endpoint.delete"
  | "endpoint.rotate-secret"
  | "endpoint.disable"
  | "endpoint.enable"
  | "delivery.retry"
  | "endpoint.recover";

/**
 * A single control-plane audit record. Publishes are deliberately *not*
 * audited — they are data-plane traffic, and the message log is their record.
 */
export interface AuditEntry {
  action: AuditAction;
  /** ISO-8601 timestamp. */
  at: string;
  by?: Actor | null;
  /** The application the action was scoped to (absent for global event types). */
  applicationKey?: string;
  /** Endpoint id / event type name / delivery id the action targeted. */
  subjectId?: string;
  message?: string;
}

/**
 * The wire envelope receivers get — the Standard Webhooks recommended shape.
 * `type` is the event type name, `timestamp` the event-occurred time, and
 * `data` the published payload.
 */
export interface WebhookEnvelope {
  type: string;
  timestamp: string;
  data: JsonValue;
}
