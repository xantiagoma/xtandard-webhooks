/**
 * Role-based authorization: `rolesAuthorization()` maps role names to the
 * actions they grant (built-in `admin`/`editor`/`viewer` policy by default),
 * with a `readonly` switch that denies every mutating action.
 *
 * Import from `@xtandard/webhooks/authorization/roles`.
 *
 * @module authorization/roles
 */

export * from "./authorization/roles.ts";
