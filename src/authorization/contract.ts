/**
 * Authorization contract. Answers: "Can this principal perform this action on
 * this resource?"
 *
 * Every mutating admin API route consults the {@link AuthorizationProvider}.
 * Ships `none`/`roles`/`delegated` implementations.
 *
 * @module
 */

import {
  defineActions,
  type AuthorizationProvider as KitAuthorizationProvider,
  type AuthorizeInput as KitAuthorizeInput,
} from "@xtandard/kit/authorization";

/** Every action an admin API route can require. */
export type WebhooksAction =
  | "application:read"
  | "application:create"
  | "application:update"
  | "application:delete"
  | "event-type:read"
  | "event-type:create"
  | "event-type:update"
  | "event-type:delete"
  | "endpoint:read"
  | "endpoint:create"
  | "endpoint:update"
  | "endpoint:delete"
  | "endpoint:rotate-secret"
  | "endpoint:read-secret"
  | "message:read"
  | "message:publish"
  | "delivery:read"
  | "delivery:retry"
  | "audit:read";

/** The resource an action targets. */
export type WebhooksResource =
  | { type: "application"; applicationKey: string }
  | { type: "event-type"; name: string }
  | { type: "endpoint"; applicationKey: string; endpointId: string }
  | { type: "message"; applicationKey: string; messageId?: string }
  | { type: "delivery"; applicationKey: string; deliveryId?: string }
  | { type: "audit"; applicationKey?: string };

/** What {@link AuthorizationProvider.authorize} receives. */
export type AuthorizeInput = KitAuthorizeInput<WebhooksAction, WebhooksResource>;

/** Decides whether a principal may perform an action on a resource. */
export type AuthorizationProvider = KitAuthorizationProvider<WebhooksAction, WebhooksResource>;

/** The action constants (`ALL_ACTIONS`, `MUTATING_ACTIONS`, `isMutatingAction`). */
export const WEBHOOKS_ACTIONS = defineActions<WebhooksAction>({
  all: [
    "application:read",
    "application:create",
    "application:update",
    "application:delete",
    "event-type:read",
    "event-type:create",
    "event-type:update",
    "event-type:delete",
    "endpoint:read",
    "endpoint:create",
    "endpoint:update",
    "endpoint:delete",
    "endpoint:rotate-secret",
    "endpoint:read-secret",
    "message:read",
    "message:publish",
    "delivery:read",
    "delivery:retry",
    "audit:read",
  ],
  mutating: [
    "application:create",
    "application:update",
    "application:delete",
    "event-type:create",
    "event-type:update",
    "event-type:delete",
    "endpoint:create",
    "endpoint:update",
    "endpoint:delete",
    "endpoint:rotate-secret",
    "message:publish",
    "delivery:retry",
  ],
});

/** Actions that change state; denied in readonly mode. */
export const MUTATING_ACTIONS: ReadonlySet<WebhooksAction> = WEBHOOKS_ACTIONS.MUTATING_ACTIONS;

/** Whether `action` changes state. */
export const isMutatingAction = (action: WebhooksAction): boolean =>
  WEBHOOKS_ACTIONS.isMutatingAction(action);
