# UI

Two ways to get the interface: the **bundled SPA** every adapter serves automatically, and the **React embed** for hosts that want the dashboard or the customer portal inside their own React tree. Same design system as `@xtandard/flags` — a user of one dashboard feels zero friction in the other.

## `<WebhooksPortal>` — the flagship embed

Your customers manage their own endpoints and inspect their own deliveries inside _your_ product:

```tsx
import { useEffect, useState } from "react";
import { WebhooksPortal } from "@xtandard/webhooks/react";
import "@xtandard/webhooks/react/styles.css";

export function WebhooksSettingsPage() {
  const [token, setToken] = useState<string>();
  useEffect(() => {
    // Your endpoint, authenticated by your app, minting a scoped token
    fetch("/api/webhooks-portal-token").then(async (r) => setToken((await r.json()).token));
  }, []);
  if (!token) return null;
  return <WebhooksPortal apiBaseUrl="/webhooks" token={token} />;
}
```

The component attaches the token as a Bearer credential on every API call; the panel force-scopes everything to the token's application (`docs/PORTAL.md`). The rendered chrome is the reduced portal set: Endpoints, Messages, Deliveries, read-only event catalog.

## `<WebhooksDashboard>` — the full admin, embedded

```tsx
import { WebhooksDashboard } from "@xtandard/webhooks/react";
import "@xtandard/webhooks/react/styles.css";

<WebhooksDashboard apiBaseUrl="/webhooks" initialApplicationKey="acme" />;
```

Props (both components unless noted): `apiBaseUrl` (where the panel is mounted), `credentials`/`fetch` (auth plumbing for your setup), `logoUrl`, `theme` (below), `initialApplicationKey` (dashboard only), `token` (portal only). Routing is hash-based inside the embed so it never fights your router. React 18/19 are optional peers — only this subpath needs them.

### Theme

The embed resolves one theme and applies it to its own wrapper (`<div class="xtandard-webhooks" data-theme="…">`) — it never writes to your document, and surfaces, text, borders, popups, toasts and code views all come from that one theme.

| `theme`              | Behavior                                                                                                                                                                                                                                | Switcher |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `"auto"` (default)   | The panel's own system/light/dark switcher; the choice is persisted in `localStorage`.                                                                                                                                                  | shown    |
| `"inherit"`          | Follows your app, live: a `dark`/`light` class or `data-theme="dark\|light"` on `<html>` (then `<body>`) — what class- and attribute-based theme switchers set — falling back to the OS `prefers-color-scheme` when neither is present. | hidden   |
| `"light"` / `"dark"` | Forces one theme. Use it when your app tracks its theme some other way: pass your resolved value.                                                                                                                                       | hidden   |

```tsx
// App with a class-based switcher (`<html class="dark">`): just inherit.
<WebhooksDashboard apiBaseUrl="/webhooks" theme="inherit" />

// Theme held in app state instead: pass the resolved value.
<WebhooksDashboard apiBaseUrl="/webhooks" theme={isDark ? "dark" : "light"} />
```

## The bundled SPA

Served by every adapter at the mount point; no React required in the host. Views:

| View        | What it does                                                                                                                                                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview    | per-application 24h attempts, success rate, dead-letter count, recent failures                                                                                                                                                                                                              |
| Endpoints   | list + detail: URL/description, subscriptions, custom headers, secret reveal/rotate (grace note), send example, recover since-date, enable/disable, type-to-confirm delete                                                                                                                  |
| Event Types | grouped catalog, description + JSON-schema editor, deprecated flag; the catalog is public at `/api/event-types.json`                                                                                                                                                                        |
| Messages    | filterable log with cursor pagination; detail = envelope viewer + its deliveries                                                                                                                                                                                                            |
| Deliveries  | the operational heart: All/Pending/Succeeded/Dead-letter tabs, endpoint filter, attempt timeline (status, duration, truncated response body, trigger), Retry, and a **Request** inspector showing the exact signed request sent (headers incl. `webhook-signature`, body) with Copy-as-curl |
| Audit       | who did what, when                                                                                                                                                                                                                                                                          |

The application switcher lives in the shell (`?app=` in the URL). Portal mode (a request authenticated by a `whpt_` token, or `?token=whpt_…` on the SPA URL) renders the reduced chrome from the same bundle.

## Design system

Byte-identical `styles.css` with `@xtandard/flags`: Tailwind v4, neutral oklch palette with a single blue accent, dark mode via `data-theme`, JetBrains Mono for keys/ids, Base UI primitives, lucide icons. Custom look: override the CSS custom properties in `:root` after importing the stylesheet — every color/radius/font is a token.
