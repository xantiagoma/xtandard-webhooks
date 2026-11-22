/**
 * Role-based {@link AuthorizationProvider}. Maps each role name to the set of
 * {@link WebhooksAction}s it grants, then allows an action when *any* of the
 * principal's roles grants it.
 *
 * The policy is a flat `Record<roleName, WebhooksAction[] | "*">` — `"*"` is a
 * wildcard granting every action. When no `policy` is supplied, the built-in
 * {@link DEFAULT_ROLE_POLICY} applies (`admin`/`editor`/`viewer`).
 *
 * A `readonly` switch denies every {@link isMutatingAction mutating} action
 * regardless of role — handy for read-only mirrors or "break glass" lockdowns.
 *
 * @module
 */

import {
  rolesAuthorization as kitRoles,
  type RolePolicy as KitRolePolicy,
} from "@xtandard/kit/authorization/roles";
import {
  WEBHOOKS_ACTIONS,
  type AuthorizationProvider,
  type WebhooksAction,
  type WebhooksResource,
} from "./contract.ts";

/** Every action in the system, used to expand non-wildcard "all actions" presets. */
export const ALL_ACTIONS: readonly WebhooksAction[] = WEBHOOKS_ACTIONS.ALL_ACTIONS;

/**
 * Every read-only action (the `*:read` subset of {@link ALL_ACTIONS}).
 * `endpoint:read-secret` is deliberately excluded — secret access is sensitive
 * and must be granted explicitly.
 */
export const READ_ACTIONS: readonly WebhooksAction[] = ALL_ACTIONS.filter((a) =>
  a.endsWith(":read"),
);

/** A role policy: each role maps to an explicit action list or the `"*"` wildcard. */
export type RolePolicy = KitRolePolicy<WebhooksAction>;

/**
 * The default role policy applied when {@link RolesAuthorizationOptions.policy}
 * is omitted.
 *
 * - `admin` — `"*"`, every action.
 * - `editor` — every action (explicit list, equivalent to `admin` here).
 * - `viewer` — every `*:read` action only.
 */
export const DEFAULT_ROLE_POLICY: RolePolicy = {
  admin: "*",
  editor: [...ALL_ACTIONS],
  viewer: [...READ_ACTIONS],
};

/** Options for {@link rolesAuthorization}. */
export interface RolesAuthorizationOptions {
  /**
   * Role → granted actions. `"*"` grants everything. Defaults to
   * {@link DEFAULT_ROLE_POLICY} when omitted.
   */
  policy?: RolePolicy;
  /**
   * When `true`, every {@link isMutatingAction mutating} action is denied
   * regardless of the principal's roles.
   * @default false
   */
  readonly?: boolean;
}

/**
 * Create a role-based {@link AuthorizationProvider}.
 *
 * Decision order:
 * 1. If `readonly` and the action mutates → **deny**.
 * 2. If the principal is `null` → **deny**.
 * 3. If any of the principal's roles grants the action (via `"*"` or an explicit
 *    list) → **allow**; otherwise **deny**.
 *
 * @example
 * ```ts
 * import { rolesAuthorization } from "@xtandard/webhooks/authorization/roles";
 *
 * // Built-in admin/editor/viewer policy:
 * const authz = rolesAuthorization();
 *
 * // Custom policy:
 * const custom = rolesAuthorization({
 *   policy: {
 *     ops: ["delivery:read", "delivery:retry", "endpoint:read"],
 *     auditor: ["audit:read"],
 *   },
 * });
 * ```
 */
export function rolesAuthorization(options: RolesAuthorizationOptions = {}): AuthorizationProvider {
  return kitRoles<WebhooksAction, WebhooksResource>({
    policy: options.policy ?? DEFAULT_ROLE_POLICY,
    actions: WEBHOOKS_ACTIONS,
    readonly: options.readonly,
  });
}
