# portal-embed × @xtandard/webhooks

Embed the **customer-scoped consumer portal** as a React component inside your
own app — a SaaS "Developer Settings → Webhooks" page where each customer
manages only _their_ endpoints and sees only _their_ deliveries.

```tsx
import { WebhooksPortal } from "@xtandard/webhooks/react";
import "@xtandard/webhooks/react/styles.css";

// token = a whpt_… portal token your backend minted with createPortalToken()
<WebhooksPortal apiBaseUrl="https://api.example.com/webhooks" token={token} />;
```

`react` + `react-dom` are peers. Build the package at the repo root first
(`bun run build`).

## What's here

- **`start.ts`** — boots an in-memory panel on **:3701** (seeded with the
  `acme-customer` application, a Billing event catalog, and one endpoint),
  configured with `portal: { secret }` + `cors` for the Vite origin. It also
  serves **`POST /portal-token`** — standing in for the _host app's_
  session-guarded backend route that mints a token for the signed-in customer
  with `createPortalToken()`. The secret never reaches the browser.
- **A Vite React host app** on **:5190** — fetches `/portal-token` (proxied to
  the demo server so it looks same-origin, like your own backend would be),
  then renders `<WebhooksPortal>` pointed cross-origin at the panel.

Because the token rides as an `Authorization: Bearer` header (no cookies), the
cross-origin embed only needs the panel's `cors` option — no `credentials`.

## Run it

```bash
# from the repo root — boots the seeded panel on :3701 + the vite host app:
bun run examples:portal-embed          # → http://localhost:5190

# or manually, in this directory:
bun install
bun run start                          # panel + mint route + vite in one command
```

## The loop

1. Open <http://localhost:5190>. The host app mints a portal token for
   `acme-customer` and mounts the portal: it opens pinned to that application —
   no application switcher, no admin-only surfaces.
2. Add or edit an endpoint, browse the event catalog — everything the bearer
   does is confined to `acme-customer`.
3. Verify the scoping from outside:

   ```bash
   TOKEN=$(curl -s -X POST localhost:3701/portal-token | jq -r .token)
   curl -s -H "authorization: Bearer $TOKEN" localhost:3701/config   # → "portal": true
   ```

## Files

- [`start.ts`](./start.ts) — the seeded panel, the `/portal-token` mint route, and the Vite spawn.
- [`src/App.tsx`](./src/App.tsx) — the host app: fetch a token, render `<WebhooksPortal>`.
- [`vite.config.ts`](./vite.config.ts) — proxies `/portal-token`; the panel API itself is cross-origin.
