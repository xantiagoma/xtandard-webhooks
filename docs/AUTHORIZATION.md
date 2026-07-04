# Authorization

May this principal do this? Evaluated per request against an action + resource pair; three providers ship.

## Actions and resources

```ts
type WebhooksAction =
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
```

Resources carry scope (`applicationKey`, `endpointId`, …) so a provider can answer per-tenant questions, not just per-verb ones. `MUTATING_ACTIONS` / `isMutatingAction` are exported for "read-only vs write" style policies.

## Bundled providers

### `@xtandard/webhooks/authorization/none` (default)

Everything allowed. Pair only with real auth or a private network.

### `@xtandard/webhooks/authorization/roles`

```ts
import { rolesAuthorization, DEFAULT_ROLE_POLICY } from "@xtandard/webhooks/authorization/roles";

const authorization = rolesAuthorization(); // DEFAULT_ROLE_POLICY
```

Maps `principal.roles` through a policy:

| Role     | Grant                                                                                     |
| -------- | ----------------------------------------------------------------------------------------- |
| `admin`  | `"*"` — everything                                                                        |
| `editor` | every concrete action (`ALL_ACTIONS`)                                                     |
| `viewer` | `READ_ACTIONS` — every `*:read` action, deliberately **excluding** `endpoint:read-secret` |

Supply your own `policy` to rename roles or narrow grants; unknown roles grant nothing; a principal needs at least one granting role per action.

### `@xtandard/webhooks/authorization/delegated`

```ts
import { delegatedAuthorization } from "@xtandard/webhooks/authorization/delegated";

const authorization = delegatedAuthorization({
  async authorize({ principal, action, resource }) {
    return myPolicyEngine.check(principal.id, action, resource); // boolean
  },
});
```

Bridge to whatever your app uses (Casbin, OPA, hand-rolled ACLs).

## Portal principals bypass all of this — on purpose

A request authenticated by a portal token is authorized by the portal's own force-scoping (token's application only, `portal.allow` actions only, default `DEFAULT_PORTAL_ACTIONS`); your authorization provider is never consulted for it. Defense in depth: a bug in host policy code can't widen a customer's portal into another tenant. See ADR 0006 and `docs/PORTAL.md`.
