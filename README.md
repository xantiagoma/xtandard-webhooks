# @xtandard/webhooks

> Self-hosted, embeddable, [Standard Webhooks](https://www.standardwebhooks.com)-compliant outbound-webhooks control plane. Mount it inside your existing app, point it at the database you already run, and ship signed events with retries, dead-lettering, and a customer-facing portal — no per-message SaaS pricing, no separate service to operate.

> `publish()` never blocks on a customer's server. Your app publishes; the dispatcher inside your process delivers; your customers self-serve through an embeddable portal.

Status: under active development, pre-0.1.0. Not published yet.

Sibling project: [`@xtandard/flags`](https://github.com/xantiagoma/xtandard-flags) — same product line, same architecture, same UI patterns.

## What this will be

- A control plane for **applications** (your customers), **event types**, and **endpoints** (customer-registered URLs), with signed delivery, automatic retries with exponential backoff, dead-letter handling, manual replay, and full delivery observability.
- **Standard Webhooks** compliant signing — receivers verify with the official `standardwebhooks` libraries in any language.
- An **in-process delivery engine** that keeps delivering even when the admin UI is unused or unmounted; multi-instance safe via lease-based claiming.
- A bundled admin SPA mountable into Elysia, Hono, Express, Bun — consumers never install React.
- An embeddable **consumer portal** React component (`<WebhooksPortal>`): your customers manage their own endpoints and inspect their own deliveries, scoped by a signed portal token.
- Pluggable storage over the DB you already have: memory, file, Redis, Postgres, Drizzle, MongoDB, SQLite, libSQL, unstorage, Cloudflare KV.
- Receiver-side verification helpers (`@xtandard/webhooks/receiver`) so the same package serves both sides of a webhook.

## License

MIT
