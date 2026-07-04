# Auth

Who is making this request? Authentication is a pluggable provider on the panel; three ship, and the contract is one function if you need your own. (Whether they _may_ do it is authorization — `docs/AUTHORIZATION.md`. Portal tokens are a third, separate lane — `docs/PORTAL.md`.)

## The contract

```ts
interface Principal {
  id: string;
  email?: string;
  name?: string;
  roles?: string[];
  metadata?: Record<string, unknown>;
}

interface AuthProvider {
  authenticate(request: Request): Promise<Principal | Response | null>;
}
```

Return a `Principal` to admit, a `Response` to short-circuit (e.g. a `401` challenge), or `null` for "not authenticated" (the handler answers 401).

## Bundled providers

### `@xtandard/webhooks/auth/none` (default)

```ts
import { noAuth, ANONYMOUS_PRINCIPAL } from "@xtandard/webhooks/auth/none";
```

Everyone is `anonymous`. The default so the five-minute quickstart works — put anything internet-reachable behind real auth.

### `@xtandard/webhooks/auth/basic`

```ts
import { basicAuth, hashPassword } from "@xtandard/webhooks/auth/basic";

const auth = basicAuth({
  users: [{ username: "ops", passwordHash: await hashPassword("s3cret"), roles: ["admin"] }],
});
```

HTTP Basic with scrypt password hashes (never plaintext at rest), timing-safe verification, and a proper `WWW-Authenticate` challenge. Pair with `AUTH_MODE=basic` + `AUTH_USERNAME`/`AUTH_PASSWORD_HASH` on the CLI/standalone.

### `@xtandard/webhooks/auth/delegated`

```ts
import { delegatedAuth } from "@xtandard/webhooks/auth/delegated";

const auth = delegatedAuth({
  async resolve(request) {
    const session = await myApp.getSession(request); // your cookie/JWT/IdP
    return session ? { id: session.userId, email: session.email, roles: session.roles } : null;
  },
});
```

The integration point for the auth your app already has — the panel never sees credentials, only your resolved principal.

## Wiring

```ts
webhooksPanel({
  storage,
  auth, // AuthProvider
  authorization, // see docs/AUTHORIZATION.md
  portal: { secret }, // optional third lane, see docs/PORTAL.md
});
```

Order of evaluation per request: a presented `whpt_` bearer token wins (and, if invalid, fails closed with 401 — it never falls back to host auth); otherwise your `auth` provider runs; public routes (`/config`, `/api/openapi.json`, `/api/event-types.json`, static UI assets) skip auth entirely.
