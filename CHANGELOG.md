# Changelog

## v0.1.4

Patch — the embedded React components now render in one theme and follow the host app.

### Fixed

- **`theme="inherit"` in a dark host left the embed light, with mixed themes.** On a host that marks dark mode with `class="dark"` on `<html>`, the panel stayed light and its headings inherited the host's light text color on the panel's white cards. Two scoping bugs in `@xtandard/webhooks/react/styles.css` caused it: the dark tokens were scoped to a selector that could never match, and the panel's own background/text color never applied to its wrapper. Each embed now resolves one theme and applies it to its own wrapper (`data-theme`), so surfaces, text, borders, popups, toasts and code views always come from one theme. The embed never writes to the host document.
- **`theme="inherit"` now actually follows the host**, live: a `dark`/`light` class or `data-theme` on `<html>` (then `<body>`), falling back to `prefers-color-scheme`. The panel's theme switcher is hidden in this mode, since the host owns the theme.
- **Toasts in the embed** now render inside the scoped wrapper, so they're styled and themed.
- **JSON code views** take their syntax and editor colors from the theme tokens, so they're readable in dark mode (embed and standalone SPA).
- Docs: the embed snippets used a non-existent `baseUrl` prop; it's `apiBaseUrl`.

### Added

- `theme="light"` / `theme="dark"` force a theme on `<WebhooksDashboard>` / `<WebhooksPortal>`. Use it when the host tracks its theme in app state.
- `detectHostTheme()` and the `EmbedTheme` / `ResolvedTheme` types are exported from `@xtandard/webhooks/react`.

### Changed

- With `theme="auto"`, the embed's switcher now themes only the panel. Previously it also wrote `data-theme` onto the host's `<html>`.

## v0.1.3

Elysia 2 support.

### Added

- **`@xtandard/webhooks/elysia2`** — the Elysia adapter for Elysia 2 (`elysia@rc`). Elysia 2 takes routes as `(path, hook, handler)` and changed its class generics, so the typed `webhooksElysia` plugin from `/elysia` throws on v2 and its types don't reach Eden. The new subpath ships the same surface (`webhooksPanel` + `webhooksElysia`) built and typed against Elysia 2; pair it with `@elysia/eden`. `/elysia` is unchanged for 1.x, and its `webhooksPanel` mount handler works on both majors.
- Docs: a `.wrap()` + `AsyncLocalStorage` recipe for request context in hooks and auth providers (docs/ADAPTERS.md).

### Changed

- Peer range `elysia: ^1.0.0 || ^2.0.0-0`, so Elysia 2 prereleases satisfy it.

## v0.1.2

Patch — fixes the React embed leaking its styles into the host app.

### Fixed

- **`@xtandard/webhooks/react/styles.css` was a global, unscoped Tailwind build** — its preflight element resets (`*`, `button`, `h1`, `a`, tables) and generic utilities (`.flex`, `.border`, …) restyled the entire host app, not just the embedded dashboard. Every rule is now scoped under the embed's `.xtandard-webhooks` wrapper (preflight and utilities included), with the design tokens re-homed onto the wrapper; a build guardrail fails if any rule escapes the scope. The standalone SPA bundle (`dist/ui`) is unchanged. Base UI portals (Select/Combobox popups, Dialogs) now render inside the wrapper too, so they stay styled under the scoped stylesheet.

## v0.1.1

Patch — two fixes found integrating v0.1.0 downstream (Elysia + Drizzle/Postgres + Redis).

### Fixed

- **Idempotency on jsonb/key-canonicalizing control stores.** `publish()` compared payloads with an order-sensitive serialization, so a control store that reorders object keys on round-trip (Postgres `jsonb`, Drizzle) turned an identical re-publish of a multi-key payload into a false `IdempotencyConflictError`. The comparison is now canonical (recursively key-sorted) — order-insensitive and adapter-independent, while still detecting a genuinely different payload.
- **Panel claim-safety check with a prebuilt `core`.** When a core built with a split `queueStorage` (e.g. control in Postgres, queue in Redis) was passed as `webhooksPanel({ core })`, the "no atomic claiming" warning read the panel's options instead of the core's queue storage and warned spuriously. It now reads `core.options.queueStorage` (the source of truth). Delivery was already claim-safe; only the warning was wrong. Additionally, `storage` is no longer required when a `core` is supplied, and the handler throws clearly if neither is given.

## v0.1.0

First public release — a self-hosted, embeddable, [Standard Webhooks](https://www.standardwebhooks.com)-compliant outbound-webhooks control plane (a Svix alternative as a library).

### Highlights

- **Control plane**: applications, a global event-type catalog, and per-application endpoints, with signed delivery, secret rotation (with a grace window), enable/disable, audit log, and control-plane hooks (`before` veto / `after` offload).
- **Delivery engine**: `publish()` is HTTP-free and never blocks on a down receiver; an in-process dispatcher owns retries (Svix-compatible schedule with jitter), dead-lettering, auto-disable, and replay. Lease-based claiming makes it crash-safe and multi-instance-safe (native on Redis/memory, compare-and-swap elsewhere). At-least-once; receivers dedupe on `webhook-id`.
- **Standard Webhooks signing** (symmetric v1), verified against the spec's own reference vector. Receivers verify with the official `standardwebhooks` libraries or the zero-dependency `@xtandard/webhooks/receiver`.
- **Pluggable storage** over a four-method KV contract: memory, file, Redis (native queue claiming), Postgres, Drizzle (pg/mysql/sqlite), MongoDB, SQLite, libSQL, unstorage, Cloudflare KV. Control and delivery-queue planes can be split.
- **Bundled admin SPA** (mount in Elysia/Hono/Express/Bun; no React required in the host) with a full delivery inspector, plus a React embed exposing `<WebhooksDashboard>` and the customer-facing `<WebhooksPortal>` scoped by signed portal tokens.
- **Auth & authorization**: none/basic/delegated authentication, none/roles/delegated authorization, and force-scoped portal tokens.
- **Testing tools**: `@xtandard/webhooks/testing` (in-memory core + verifying local receiver), the `xtandard-webhooks listen` inspecting receiver, the `sign` signature playground, and an in-panel request inspector.
- **Adapters, CLI, and a standalone Docker image**, plus examples (including a polyglot interop proof against the official Python and Go libraries) and a seeded demo (`bun run demo`).

ZeroVer: the API is stabilizing; minor versions may break, patch versions do not.
