/**
 * Hook contracts — control-plane extensibility around admin mutations.
 *
 * A hook is plain JavaScript wired in at {@link ../core.createWebhooksCore}
 * time (never authored through the UI — that would be remote code execution).
 * Two phases, deliberately asymmetric:
 *
 * - **`before`** runs *before* a mutation commits. Throwing **denies** the
 *   operation (the thrown error's message is the reason). Multiple `before`
 *   hooks run **sequentially in declared order**; the first throw aborts and
 *   nothing commits. This is the enforcement primitive that governance,
 *   quotas, and publish gates build on.
 * - **`after`** runs *after* a mutation commits. It is for side effects
 *   (notifications, cache purges, offloading pruned payloads). An `after`
 *   hook **must never fail the operation** — the mutation already committed —
 *   so errors are isolated and reported via `onHookError`, not rethrown.
 *
 * Delivery *attempts* are deliberately not hook events (they are data-plane
 * traffic and can be very hot); the per-attempt tap is the separate
 * fire-and-forget {@link ../delivery-sink.DeliveryListener}. Only the terminal
 * transitions (`delivery.succeeded`, `delivery.exhausted`) surface here.
 *
 * @module
 */

import type {
  Actor,
  Application,
  AuditEntry,
  Delivery,
  DeliveryAttempt,
  Endpoint,
  EventType,
  JsonValue,
  Message,
} from "../schema.ts";

/**
 * Event delivered to {@link WebhooksHooks.before} — the *proposed* mutation,
 * before it commits. Throw from the handler to deny it.
 */
export type BeforeEvent =
  | {
      type: "application.create" | "application.update";
      application: Application;
      actor: Actor | null;
    }
  | { type: "application.delete"; applicationKey: string; actor: Actor | null }
  | { type: "event-type.upsert"; eventType: EventType; actor: Actor | null }
  | { type: "event-type.delete"; name: string; actor: Actor | null }
  | {
      type: "endpoint.create" | "endpoint.update";
      applicationKey: string;
      endpoint: Endpoint;
      actor: Actor | null;
    }
  | {
      type: "endpoint.delete" | "endpoint.rotate-secret" | "endpoint.disable" | "endpoint.enable";
      applicationKey: string;
      endpointId: string;
      actor: Actor | null;
    }
  | {
      /** The host's approval/quota gate for the publish hot path. */
      type: "message.publish";
      applicationKey: string;
      eventType: string;
      payload: JsonValue;
      idempotencyKey?: string;
      actor: Actor | null;
    }
  | { type: "delivery.retry"; applicationKey: string; deliveryId: string; actor: Actor | null }
  | {
      type: "endpoint.recover";
      applicationKey: string;
      endpointId: string;
      since: string;
      actor: Actor | null;
    };

/**
 * Event delivered to {@link WebhooksHooks.after} — the *committed* mutation.
 * Carries the resulting state in full: for destructive events this is the last
 * chance to offload the payload before it is gone from storage.
 */
export type AfterEvent =
  | { type: "application.created" | "application.updated"; application: Application; at: string }
  | {
      /** Carries the deleted application — everything under it is already gone. */
      type: "application.deleted";
      applicationKey: string;
      application: Application;
      at: string;
    }
  | { type: "event-type.upserted"; eventType: EventType; at: string }
  | { type: "event-type.deleted"; name: string; eventType: EventType; at: string }
  | {
      type:
        | "endpoint.created"
        | "endpoint.updated"
        | "endpoint.deleted"
        | "endpoint.secret-rotated"
        | "endpoint.disabled"
        | "endpoint.enabled"
        /** Disabled by the failure policy, not an operator (see dispatcher `autoDisable`). */
        | "endpoint.auto-disabled";
      applicationKey: string;
      endpoint: Endpoint;
      at: string;
    }
  | {
      type: "message.published";
      applicationKey: string;
      message: Message;
      deliveryIds: string[];
      at: string;
    }
  | {
      type: "delivery.succeeded";
      applicationKey: string;
      delivery: Delivery;
      attempt: DeliveryAttempt;
      at: string;
    }
  | {
      /** Dead-letter offload point: the retry schedule is exhausted. */
      type: "delivery.exhausted";
      applicationKey: string;
      delivery: Delivery;
      attempts: DeliveryAttempt[];
      at: string;
    }
  | {
      /** Messages removed by retention. Carries the **full messages** — offload now or lose them. */
      type: "message.pruned";
      applicationKey: string;
      messages: Message[];
      at: string;
    }
  | {
      /** Audit entries removed by retention (oldest-first). */
      type: "audit.pruned";
      applicationKey?: string;
      entries: AuditEntry[];
      at: string;
    };

/** The discriminant strings of {@link BeforeEvent} / {@link AfterEvent}. */
export type BeforeEventType = BeforeEvent["type"];
export type AfterEventType = AfterEvent["type"];

/**
 * Thrown from a {@link WebhooksHooks.before} handler to **deny** a mutation with
 * a clean HTTP status (default `403`). Any thrown error denies the mutation,
 * but a plain `Error` maps to `500` at the API layer (treated as an unexpected
 * bug); throw this to signal a deliberate policy rejection (`403`, or a custom
 * `status` such as `409`/`422`).
 *
 * @example
 * ```ts
 * before(event) {
 *   if (event.type === "message.publish" && overQuota(event.applicationKey)) {
 *     throw new HookDeniedError("Monthly webhook quota exceeded.", { status: 429 });
 *   }
 * }
 * ```
 */
export class HookDeniedError extends Error {
  /** HTTP status the API layer should respond with. Default `403`. */
  readonly status: number;
  constructor(message: string, options?: { status?: number; cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "HookDeniedError";
    this.status = options?.status ?? 403;
  }
}

/**
 * A control-plane hook. Implement `before`, `after`, or both. Pass one — or an
 * array — to {@link ../core.createWebhooksCore} via `hooks`.
 */
export interface WebhooksHooks {
  /**
   * Runs before a mutation commits. **Throw to deny** (the error propagates to
   * the caller; its message is the reason). Return/resolve to allow. Must not
   * mutate the event payload.
   */
  before?(event: BeforeEvent): void | Promise<void>;
  /**
   * Runs after a mutation commits. For side effects only. Errors are isolated
   * and reported via `onHookError` — they never fail the (already committed)
   * operation.
   */
  after?(event: AfterEvent): void | Promise<void>;
}

/** Accepts a single hook, an array, or nothing. */
export type WebhooksHooksInput = WebhooksHooks | readonly WebhooksHooks[] | undefined;

/** Reports an error thrown by an `after` hook. */
export type HookErrorReporter = (error: unknown, event: AfterEvent) => void;

/** Normalize the `hooks` option into a flat array (empty when unset). */
export function normalizeHooks(input: WebhooksHooksInput): WebhooksHooks[] {
  if (!input) return [];
  return Array.isArray(input) ? [...input] : [input as WebhooksHooks];
}

/**
 * Run every `before` hook sequentially, in order. The first hook to throw
 * aborts: the error propagates to the caller (denying the mutation) and no
 * later hook runs. A no-op when there are no `before` hooks.
 */
export async function runBefore(hooks: WebhooksHooks[], event: BeforeEvent): Promise<void> {
  for (const hook of hooks) {
    if (hook.before) await hook.before(event);
  }
}

/**
 * Run every `after` hook, isolating failures. The mutation has already
 * committed, so a throwing hook must not fail the operation — its error is
 * routed to `onError` and swallowed. Remaining hooks still run.
 */
export async function runAfter(
  hooks: WebhooksHooks[],
  event: AfterEvent,
  onError: HookErrorReporter,
): Promise<void> {
  await Promise.all(
    hooks.map(async (hook) => {
      if (!hook.after) return;
      try {
        await hook.after(event);
      } catch (error) {
        onError(error, event);
      }
    }),
  );
}

/** Default `after`-hook error reporter: warn, but never throw. */
export const defaultHookErrorReporter: HookErrorReporter = (error, event) => {
  // eslint-disable-next-line no-console
  console.warn(`[@xtandard/webhooks] after-hook for "${event.type}" threw:`, error);
};
