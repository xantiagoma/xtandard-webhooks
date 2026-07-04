# Auth × @xtandard/webhooks

Authentication ("who is this request?") and authorization ("may they do it?")
are two small **pluggable contracts** — plus portal tokens for customer-scoped
access. This one example mounts the panel with a different setup per
`AUTH_DEMO` mode so you can see them all, with a portal-token mint route
running side-by-side in every mode.

## What's here

| `AUTH_DEMO` | Authentication     | Notes                                                                          |
| ----------- | ------------------ | ------------------------------------------------------------------------------ |
| `none`      | none (open)        | every request is the anonymous principal; paired with `noAuthorization()`      |
| `basic`     | HTTP Basic         | one user with an **encrypted** (scrypt) password, one with **plaintext** (dev) |
| `delegated` | `X-API-Key` lookup | `delegatedAuth` — bring-your-own auth is one `Request → Principal` function    |
| `rbac`      | Basic, 3 users     | demonstrates **authorization**: admin / support / viewer role policy           |

And in **every** mode:

- **`POST /portal-token?app=acme`** — a host route that mints a `whpt_…` token
  with `createPortalToken(secret, applicationKey)`. The panel (mounted with
  `portal: { secret }`) accepts it as a bearer and force-scopes it to that
  application: customers manage their own endpoints and inspect their own
  deliveries, and nothing else.

## Run it

```bash
bun install
AUTH_DEMO=rbac bun run start    # default; modes above
# or from the repo root:  bun run examples:auth
```

## The loop

```bash
# none — anything works
AUTH_DEMO=none bun run start
curl -s localhost:3000/api/applications                                 # 200

# basic — encrypted (admin/s3cret) or plaintext (dev/dev)
AUTH_DEMO=basic bun run start
curl -su admin:s3cret localhost:3000/api/applications                   # 200
curl -su admin:wrong  localhost:3000/api/applications                   # 401

# delegated — API keys: key-admin | key-support | key-viewer
AUTH_DEMO=delegated bun run start
curl -s -H 'x-api-key: key-admin' localhost:3000/api/applications       # 200

# rbac — alice/alice (admin), bob/bob (support), carol/carol (viewer)
AUTH_DEMO=rbac bun run start
API=localhost:3000/api
curl -so/dev/null -w '%{http_code}\n'                $API/applications  # 401 (no creds)
curl -so/dev/null -w '%{http_code}\n' -u carol:carol $API/applications  # 200 viewer reads
curl -so/dev/null -w '%{http_code}\n' -u carol:carol -X POST $API/applications -d '{"key":"x"}' \
  -H 'content-type: application/json'                                   # 403 viewer can't write
curl -so/dev/null -w '%{http_code}\n' -u alice:alice -X POST $API/applications -d '{"key":"x"}' \
  -H 'content-type: application/json'                                   # 201 admin can

# portal tokens — every mode; scoped to ONE application
TOKEN=$(curl -s -X POST 'localhost:3000/portal-token?app=acme' | sed -E 's/.*"token":"([^"]+)".*/\1/')
curl -s -H "authorization: Bearer $TOKEN" $API/applications/acme/endpoints   # 200 own app
curl -so/dev/null -w '%{http_code}\n' -H "authorization: Bearer $TOKEN" \
  $API/applications/other/endpoints                                          # 403 cross-app denied
```

In your own app:

```ts
import { createFetchHandler } from "@xtandard/webhooks";
import { basicAuth } from "@xtandard/webhooks/auth/basic";
import { rolesAuthorization } from "@xtandard/webhooks/authorization/roles";

createFetchHandler({
  storage,
  auth: basicAuth({ users: [{ username: "admin", passwordHash, roles: ["admin"] }] }),
  authorization: rolesAuthorization({ policy: { admin: "*" } }),
  portal: { secret: process.env.PORTAL_SECRET! },
});
```

Generate a password hash:
`bun -e "import('@xtandard/webhooks/auth/basic').then(m => m.hashPassword('pw').then(console.log))"`.
Both contracts also have a `delegated` built-in (`auth/delegated`,
`authorization/delegated`) to call out to your own service.

## Files

- [`src/index.ts`](./src/index.ts) — the mode switch, the panel, and the portal mint route.
