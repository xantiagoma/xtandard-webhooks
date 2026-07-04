/**
 * Authorization contract. Answers: "Can this principal perform this action on
 * this resource?"
 *
 * Every mutating admin API route consults the {@link AuthorizationProvider}.
 * Ships `none`/`roles`/`delegated` implementations.
 *
 * @module
 */

import type { Principal } from "../auth/contract.ts";

/** The full set of authorizable actions. */
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

/** Input passed to {@link AuthorizationProvider.authorize}. */
export interface AuthorizeInput {
  principal: Principal | null;
  action: WebhooksAction;
  resource: WebhooksResource;
  request: Request;
}

/** Decides whether an action is permitted. */
export interface AuthorizationProvider {
  authorize(input: AuthorizeInput): Promise<boolean>;
}

/** Actions that mutate state — blocked in readonly mode. */
export const MUTATING_ACTIONS: ReadonlySet<WebhooksAction> = new Set<WebhooksAction>([
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
]);

/** True if the action mutates state. */
export const isMutatingAction = (action: WebhooksAction): boolean => MUTATING_ACTIONS.has(action);
