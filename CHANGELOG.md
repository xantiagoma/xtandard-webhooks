# Changelog

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
