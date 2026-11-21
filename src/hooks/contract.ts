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
import {
  createHookErrorReporter,
  type HookErrorReporter as KitHookErrorReporter,
  type Hooks,
  type HooksInput,
} from "@xtandard/kit/hooks";

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

export { HookDeniedError, normalizeHooks, runAfter, runBefore } from "@xtandard/kit/hooks";

/**
 * Lifecycle hooks: `before` may deny a mutation by throwing (sequential, the
 * first throw aborts); `after` observes committed changes (concurrent, errors
 * isolated and reported).
 */
export type WebhooksHooks = Hooks<BeforeEvent, AfterEvent>;

/** One hook object, an array of them, or nothing (as `hooks` options accept). */
export type WebhooksHooksInput = HooksInput<BeforeEvent, AfterEvent>;

/** Receives an error thrown by an `after` hook, with the event it was handling. */
export type HookErrorReporter = KitHookErrorReporter<AfterEvent>;

/** The default reporter: `console.warn` with the `[@xtandard/webhooks]` prefix. */
export const defaultHookErrorReporter: HookErrorReporter =
  createHookErrorReporter("@xtandard/webhooks");
