# ADR 0001 — Single Package with Subpath Exports

**Status:** Accepted

---

## Context

`@xtandard/webhooks` ships a large surface: a control-plane core, a delivery engine, Standard Webhooks signing, receiver verification helpers, storage adapters (memory, file, Redis, Postgres, Drizzle, MongoDB, SQLite, libSQL, unstorage, Cloudflare KV), auth and authorization providers, framework adapters (Elysia, Hono, Express, Bun), a bundled admin SPA, a React embed, and test helpers. Many of these pull in optional peer dependencies (`redis`, `pg`, `mongodb`, `drizzle-orm`, `elysia`, `react`, …).

The sibling project `@xtandard/flags` faced the identical trade-off and settled it in its ADR 0001. The alternatives were the same here:

- **Multiple packages** — separately versioned and published, with real coordination overhead.
- **One package, one entry point** — every consumer's bundler must tree-shake past optional peers it doesn't have installed, which breaks at resolve time, not shake time.
- **One package, explicit subpath exports** — each logical unit is a separate export condition in `package.json`.

The key constraints:

- `publish()` and `verify()` are hot paths and must have **zero optional dependencies**.
- Optional peers must not be resolved unless the consumer explicitly imports the subpath that needs them.
- Consumers install one package and choose what they wire up.

---

## Decision

Ship `@xtandard/webhooks` as a **single npm package with explicit subpath exports** mapping to thin `entry-*.ts` re-export entrypoints, built as independent entry points by vite-plus (`vp pack`) into dual ESM/CJS bundles with `.d.mts`/`.d.cts` declarations — the exact mechanism proven in `@xtandard/flags`.

Every new subpath requires four edits, or CI-only failures appear: `src/entry-*.ts`, `vite.config.ts` `pack.entry`, `package.json` `exports`, and `examples/tsconfig.json` `paths`.

---

## Consequences

- One version number, one release pipeline, one README.
- Missing optional peers fail at import time with an actionable `requirePeer` message naming the exact `bun add` command.
- The exports map is large but mechanical; `publint` guards it in CI.
