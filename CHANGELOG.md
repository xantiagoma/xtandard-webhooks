# Changelog

## v0.3.0

[compare changes](https://github.com/xantiagoma/xtandard-webhooks/compare/v0.2.1...v0.3.0)

No public name is removed. The exported types are now aliases of the kit's types, so declaration merging no longer works on them. Unknown `STORAGE_DRIVER` values now stop the CLI, and MySQL trailing-space collisions now throw. Details are under "Migration" below.

### Changed

- **`@xtandard/webhooks` is now built on [`@xtandard/kit`](https://me.xantiagoma.com/xtandard-kit/)**,
  the shared building blocks of the xtandard products, as a regular dependency (`^0.1.1`). You never
  install or configure it. Every subpath, exported name, config shape, CLI command, env variable,
  HTTP route and stored-data format stays as it was; the storage drivers, auth/authorization
  providers, hooks runner, portal-token mechanics, panel/HTTP plumbing, framework adapters, CLI
  plumbing, admin-shell UI and build tooling are the kit's, with the webhooks defaults passed
  explicitly (table `xtandard_webhooks`, Mongo `xtandard_webhooks`/`webhooks_kv`, pg channel
  `xtandard_webhooks`, realm `xtandard-webhooks`, the `whpt_` prefix with a 7-day lifetime, base62
  ids, readonly 403, `__WEBHOOKS_CONFIG__`, the `xtandard-webhooks:theme` key and the
  `.xtandard-webhooks` scope).
- **Kit fixes reach you without a webhooks release.** A kit patch is picked up on your next install.
  The Docker image is the exception: it is rebuilt with the new kit by the Docker workflow's
  `refresh-kit` run.
- Every storage driver except unstorage and Cloudflare KV now has **`compareAndSwap`** (file, sqlite,
  libsql, postgres, drizzle on pg/mysql/sqlite, mongodb, redis and RedisJSON), so the dispatcher's
  generic claim path is atomic on all of them. The "dispatcher without atomic claiming" warning now
  only fires for unstorage and Cloudflare KV.
- `claimDue` (memory, redis) claims each delivery with a compare-and-swap.
- The panel (`createFetchHandler` and every adapter result) has a **`close()`** that stops the
  dispatcher it started.
- `createPortalToken` / `verifyPortalToken` accept a **list of secrets** for rotation: the first
  signs, any of them verifies. Keep the old secret until the longest-lived token signed with it has
  expired.
- `mysqlWebhooksTable` / `pgWebhooksTable` accept a `keyCollation` (`utf8mb4_0900_bin` /
  `utf8mb4_nopad_bin` on MySQL/MariaDB, `"C"` on Postgres) for new tables. The defaults are
  unchanged, so `drizzle-kit` generates no migration.
- `createFileStorage` takes `legacy` (`"ignore"` | `"warn"` (default, as before) |
  `"read-through"`) and `onLegacy` for stores written by v0.1.4 and earlier.
- `createLogHook` takes `json: true` (one JSON object per line) and `describe(event)`.
- The CLI: `--key=value` flags, `AUTH_ROLE` (the basic-auth user's role, default `admin`),
  `{STORAGE,QUEUE}_SQLITE_TABLE` and `{STORAGE,QUEUE}_LIBSQL_URL`; the banner shows the resolved
  path of a `file:` libSQL database.
- Durations accept weeks (`"2w"`).
- The OpenAPI document's `info.version` is the package version (it was hard-coded `0.1.0`).
- The SPA accepts the portal token as `#token=…` (preferred: the fragment never reaches servers or
  logs) as well as `?token=…`.
- CI runs on the kit's reusable workflows (`redis:8`, so the RedisJSON conformance cases run; e2e and
  the examples typecheck on); the Docker workflow smoke-tests the image before pushing and can be
  re-run with `refresh-kit`; `release.yml` prepares through the kit and publishes itself.
- Driver errors name the `@xtandard/webhooks/storage/<driver>` import path.

### Fixed

Inherited from the kit (inventory §3; each has a permanent kit test):

- **Unknown `STORAGE_DRIVER` / `QUEUE_STORAGE_DRIVER` is an error** (`Unknown STORAGE_DRIVER
"postgress" (expected one of: …)`); a typo used to silently fall back to the `file` driver.
- An **empty env variable counts as unset** (`PORT=` in a `.env` file now means the default, not
  `""`).
- **Re-validated path parameters**: every application key, event type name and id in an admin API
  path must match `KEY_REGEX`, else 404. On MySQL (Drizzle, `utf8mb4_bin`, a PAD SPACE collation)
  `DELETE /api/applications/acme%20` used to act on `acme`.
- **MySQL trailing-space keys never cross**: reads, removes and swaps match keys byte-exactly, and a
  write whose key differs from a stored key only by trailing spaces throws `KeyCollisionError`
  instead of overwriting it.
- MySQL (Drizzle): `getKeys` no longer skips keys containing supplementary characters (emoji).
- A malformed `%` escape in an admin API path is a 404, not a 500.
- The panel title is HTML-escaped in `index.html` (and the base href, and U+2028/U+2029 in the
  bootstrap JSON).
- The SPA's `index.html` is served `cache-control: no-cache`, so an upgrade never serves a stale page
  that points at deleted hashed assets; `/healthcheck` answers inside the panel (`{ ok: true }`)
  under any base path; a non-GET on a non-API path is 405 with `Allow: GET, HEAD`.
- **Portal SPA race**: the shell waits for `/config` before rendering the default route or running
  any admin query, and a portal token means portal from the first render, so a portal never fires
  admin requests.
- The SPA removes `?token=` / `#token=` from the address bar, so a portal link isn't bookmarked,
  shared or sent in `Referer`.
- `WebhooksPortal` refetches everything when its `token` changes (a new token may carry a different
  application) and clears the token on unmount; the embed's `routing: "memory"` keeps the query
  string (`?app=`).
- **Portal tokens reject an empty secret** (on create and verify).
- Express adapter and the CLI's Node server: every `Set-Cookie` header is kept, multi-value request
  headers are no longer joined, bodies already parsed by `express.json()` / `urlencoded()` are
  re-serialised correctly, responses stream with backpressure (they were buffered), the body is
  cancelled when the client disconnects, and `HEAD` has no body.
- Elysia adapters: `PATCH` and `DELETE` bodies are forwarded (they were dropped), a stale
  `content-length` is not, and two mounts with different prefixes are no longer de-duplicated by
  the plugin name.
- Storage:
  - Redis `watch` no longer misses events under a prefix with glob characters; `getKeys` no longer
    returns duplicates (SCAN may repeat keys).
  - File `watch` reports a write as `update` (it reported a `rename` as `remove` even when the file
    still existed); file writes are atomic (temporary file + rename).
  - Empty key segments are distinct keys on file and unstorage (`a//b` ≠ `a/b`); unstorage keys
    ending in `$` are listed (unstorage hid them as meta keys).
  - Postgres and libSQL retry a failed connect/DDL instead of caching the failure.
  - SQLite uses `GLOB` for prefixes (case-sensitive and index-usable); Mongo re-checks `startsWith`,
    so a case-insensitive collection collation never leaks keys from another prefix.
  - Postgres/Drizzle/unstorage: a stored JSON string that looks like JSON (`"123"`) reads back as
    that string (it was parsed a second time into `123`).
  - Values are written as canonical JSON (sorted keys), so compare-and-swap is key-order-insensitive,
    and rows written by earlier releases still read, list and swap (structural fallback).
  - `compareAndSwap` compares own properties only (`{ a: undefined }` is not `{ b: undefined }`) and
    tells `{}` from `[]`.
  - `withWatch(...)` results survive an object spread.
- A thrown auth provider is still a 500 (unchanged), and a `Bearer whpt_…` header is now recognised
  in any casing of `Bearer`.
- JSON values must be finite: `NaN`/`Infinity` in a metadata or schema field are a validation error
  (they used to be stored as `null`); a valibot issue on the root object is reported at the base
  path without a trailing `.`.
- `@xtandard/webhooks/storage/sqlite` can be imported under Node (opening a database still needs
  Bun); the SQLite table is created on first use instead of in the constructor.
- The CLI runs when executed directly (`bun src/cli.ts`) and never when imported.

Kit v0.1.1 also fixes behaviour this release would otherwise have regressed: the panel on Node
20.0–20.15, negative numbers as CLI flag values (`--limit -1`), and portal-token expiry under fake
timers all work as in v0.2.x. `createFileStorage({ legacy: "read-through" })`, new in this release,
reads through a legacy file only when the mapping is unambiguous.

(Already shipped in v0.2.1, now enforced by the kit: an unknown `AUTH_MODE` is an error, not an open
panel.)

### Migration

- **Type-level:** `WebhooksStorage`, `WatchableWebhooksStorage`, `CompareAndSwapWebhooksStorage`,
  `TransactionalWebhooksStorage`, `AuthProvider`, `Principal`, `AuthorizationProvider`,
  `AuthorizeInput`, `WebhooksHooks`, the driver option types and the `*WebhooksStorage` result types
  are now type aliases of the kit's types (`KvStorage`, …) rather than interfaces. `implements` and
  assignments work as before; **declaration merging into them no longer does**. `PortalTokenError`
  is now a class value plus a type of the same name (`new PortalTokenError(msg)`, `instanceof` and
  `err.name === "PortalTokenError"` all still work). `WebhooksDashboard` / `WebhooksPortal` are
  `React.FC` values with `displayName`s.
- `TransactionalWebhooksStorage` and `isTransactional` are deprecated (no driver ever implemented
  them).
- **MySQL (Drizzle) users:** a write that collides with a stored key differing only by trailing
  spaces now throws `KeyCollisionError`. The admin API cannot produce such keys; code calling the
  storage directly can. To keep such keys distinct, migrate the key column to a NO PAD collation
  (`docs/STORAGE.md`).
- **`STORAGE_DRIVER` typos and empty values:** a value outside the documented list now stops the CLI
  and the image at startup instead of writing to `./.webhooks`. An empty `STORAGE_DRIVER=` now
  means the default (`file`; the image sets `memory`).
- **Validation message:** an idempotency key outside `[a-zA-Z0-9._-]` is reported as
  `must match /^[a-zA-Z0-9._-]+$/` (it added `(no slashes or path separators)`); the dot-only and
  256-character messages are unchanged.
- **Error message:** `createFetchHandler({})` throws a `TypeError` (``createFetchHandler requires either `storage` or `core`.``; it was an `Error` with a slightly different message). Driver peer-missing errors read ``@xtandard/webhooks/storage/<driver> requires the optional peer "<pkg>". Install it with: …``.

## v0.2.1

[compare changes](https://github.com/xantiagoma/xtandard-webhooks/compare/v0.2.0...v0.2.1)

Security fix for the standalone server, the CLI and the Docker image: a mistyped `AUTH_MODE` no longer serves an open panel. Library APIs, storage and the HTTP API are unchanged.

### 🩹 Fixes

- **auth:** reject unknown `AUTH_MODE` instead of serving an open panel ([#15](https://github.com/xantiagoma/xtandard-webhooks/pull/15)). Any value other than `none` or `basic` (a typo, wrong case) used to fall through to `none`, leaving the admin panel and API unauthenticated. The server now exits with `Unknown AUTH_MODE "x" (expected none or basic)` before it listens. An empty or unset `AUTH_MODE` still means `none`, and now prints the same unauthenticated-panel warning as an explicit `none`.

### Migration

None if `AUTH_MODE` is `none`, `basic` or unset. If a deployment fails to start after upgrading, its `AUTH_MODE` was invalid and the panel was open: set it to `basic` (with credentials) or `none` explicitly.

## v0.2.0

Storage correctness across every backend (case-exact keys, literal prefixes), readable Elysia adapter types, a documentation site, and the xtandard brand kit. **Two storage backends need a one-time migration**: see below.

### Migration

Only these two setups need action; every other backend (Postgres, Redis, MongoDB, SQLite, libSQL, unstorage, Cloudflare KV, memory) upgrades with no migration.

- **File storage (`@xtandard/webhooks/storage/file`): the on-disk layout changed.** Key segments are now encoded into case-safe file names. After upgrading, stop every writer (app, dispatcher, worker) and run once:

  ```ts
  import { migrateFileStorage } from "@xtandard/webhooks/storage/file";

  await migrateFileStorage({ dir: "./data/webhooks" }); // → { moved: n }; idempotent
  ```

  Until you do, files in the old layout are **ignored** (applications, endpoints and messages written by v0.1.x won't be found), and `getKeys` logs a warning once. Details: [File storage: case-safe file names](https://me.xantiagoma.com/xtandard-webhooks/storage/#file-storage-case-safe-file-names).

- **Drizzle storage on MySQL (`mysqlWebhooksTable()`): re-collate the `key` column.** New tables get `utf8mb4_bin`; a table created by v0.1.x keeps MySQL's case- and accent-insensitive default until you run (with your table name and `keyLength`, default `512`):

  ```sql
  ALTER TABLE xtandard_webhooks
    MODIFY `key` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;
  ```

  It cannot fail on duplicates. Details: [MySQL (Drizzle): a case-sensitive key column](https://me.xantiagoma.com/xtandard-webhooks/storage/#mysql-drizzle-a-case-sensitive-key-column).

### Fixed

- **File storage: keys that differ only by case shared a file on macOS and Windows** (their default filesystems are case-insensitive), so applications such as `Acme` and `acme`, or ids differing only by case, overwrote each other. Each key segment is now encoded into a case-safe, reversible file name (`Acme` → `^acme`; characters outside `[a-z0-9._~!@,=+_-]` → `%XX`). **Existing file stores need a one-time migration**: run `migrateFileStorage({ dir })` from `@xtandard/webhooks/storage/file` once, with no writer running. Until then, files in the old layout are ignored, and `getKeys` logs a warning once.
- **unstorage storage: distinct keys collided.** unstorage normalizes keys: it cuts at `?`, turns `\` and `:` into separators, and collapses repeats. The adapter now escapes `%`, `?`, `\` and `:` losslessly, and `getKeys` honours plain string prefixes that end mid-segment. Keys already stored that contain `%` (rare) are read under their escaped form.
- **Redis storage: `getKeys` treated `*`, `?`, `[`, `]` in the prefix as glob patterns.** They are now escaped in `SCAN MATCH`.
- **SQL storages (`sqlite`, `libsql`, `postgres`, Drizzle): `getKeys` could return keys that differ from the prefix by case.** SQLite's `LIKE` folds ASCII case, and a non-binary collation can fold case or accents. Results are now filtered to exact, case-sensitive prefix matches.
- **Drizzle storage on MySQL: `getKeys` was a syntax error.** It used `LIKE … ESCAPE '\'`; in MySQL the backslash escapes the closing quote. It now uses `ESCAPE '!'`, which works on every dialect. Prefixes containing `%`, `_` or `!` match literally.
- **Drizzle storage on MySQL: keys that differ only by case or accent collided.** `mysqlWebhooksTable()` now declares the `key` column with `utf8mb4_bin` (MySQL's default `utf8mb4_0900_ai_ci` folds case and accents), so `whk/Acme/…` and `whk/acme/…` are separate keys. **Existing tables need a one-time `ALTER TABLE`**: see [MySQL (Drizzle): a case-sensitive key column](https://me.xantiagoma.com/xtandard-webhooks/storage/#mysql-drizzle-a-case-sensitive-key-column).

### Added

- A documentation site: https://me.xantiagoma.com/xtandard-webhooks/ (guides, recipes and a generated API reference for every entry point).
- `WebhooksElysiaPlugin` (from `@xtandard/webhooks/elysia` and `/elysia2`): the named return type of `webhooksElysia()`, the same type as before. The API reference now shows it instead of the flattened `Elysia<…, object & object & …>` generics.

### Changed

- Brand: a generated vector kit in the xtandard family style (`docs/BRAND.md`, `scripts/brand-assets.sh`): app icon, symbol, light/dark lockups, favicons and a social card. The README header, the docs site (logo, favicons, `og:image`) and the standalone admin UI (favicon; the mark before the default title) use only its SVGs. The raster logos (`logo.png`, `logo-128.png`, `logo-256.png`, `favicon.png`) are gone; rasters remain only where a format needs them (`social.png` for `og:image`, `apple-touch-icon.png` and `favicon.ico` as `<head>` fallbacks).
- `ElysiaWebhooksHandler` is now an interface with documented members (a call signature, `core`, `dispatcher`, `openapi()`); the type itself is unchanged.
- Docs: the `/elysia2` API reference is generated against Elysia 2, and each module page lists the symbols it re-exports (e.g. `webhooksPanel` on `/elysia2`) with a link to where they are documented.

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
