# ADR 0003 — Bundled SPA UI

**Status:** Accepted

---

## Context

The admin surface (endpoints, messages, deliveries, dead-letters, replay) needs a UI. Options mirror `@xtandard/flags` ADR 0003:

- **Server-rendered templates** — couples the package to a template engine and a server framework.
- **Ship React components only** — forces every consumer to own a React build.
- **Bundled prebuilt SPA** — static assets served by the package's own fetch handler; consumers never install React.

`@xtandard/flags` proved the third option: one `vite build` produces `dist/ui`, the fetch handler serves it with an injected `__CONFIG__` + `<base>` tag so it mounts under any base path in any framework.

---

## Decision

Bundle a prebuilt React SPA (React 19, Tailwind v4, TanStack Query, wouter, CodeMirror) into `dist/ui`, served by `createFetchHandler` with `__WEBHOOKS_CONFIG__` and `<base>` injection. The same bundle renders two chromes: the full admin dashboard, and the reduced **portal** chrome when `/config` reports a portal-scoped principal — no second SPA.

A separate ESM React build (`@xtandard/webhooks/react`) exposes `<WebhooksDashboard>` and `<WebhooksPortal>` for hosts that want the UI inside their own React tree; React is an optional peer there.

---

## Consequences

- `bun add @xtandard/webhooks` + one mount line yields a working admin UI in Elysia/Hono/Express/Bun.
- UI stack upgrades are this package's problem, not the consumer's.
- The SPA is byte-identical in look and feel to `@xtandard/flags` (same tokens, same primitives) — one product line.
