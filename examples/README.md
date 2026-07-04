# Examples

Each example is a standalone mini-project — copy it out, `bun install`, run.

| Example                                     | What it shows                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [`elysia/`](./elysia)                       | Panel at `/webhooks` + an app route that `publish()`es on a user action (Elysia).          |
| [`hono/`](./hono)                           | The same see-it loop with Hono.                                                            |
| [`express/`](./express)                     | The same see-it loop with Express (panel mounted **before** the body parser).              |
| [`full-loop/`](./full-loop)                 | Sender + verifying receiver in one command; the receiver fails twice so you watch retries. |
| [`auth/`](./auth)                           | Auth + authorization flexibility: none/basic/delegated/rbac + a portal-token mint route.   |
| [`receivers/`](./receivers)                 | **Polyglot verification**: Python + Go via the official Standard Webhooks libraries, + TS. |
| [`storage-drivers/`](./storage-drivers)     | One contract, every backend — the identical publish→deliver→verify loop per driver.        |
| [`postgres-redis/`](./postgres-redis)       | **Split planes**: control plane in Postgres, delivery queue in Redis (docker compose).     |
| [`split-worker/`](./split-worker)           | Web process publishes only (`dispatcher: false`); a separate worker delivers.              |
| [`standalone-docker/`](./standalone-docker) | Run the standalone Docker image + Redis with `docker compose`.                             |

## Storage backends

Every backend implements the same tiny `WebhooksStorage` contract, so any of
them can hold the control plane (`storage`) and/or the delivery queue
(`queueStorage`). Where each is demonstrated:

| Backend                   | Import                                     | Demonstrated in                                          |
| ------------------------- | ------------------------------------------ | -------------------------------------------------------- |
| memory                    | `@xtandard/webhooks/storage/memory`        | [`storage-drivers/`](./storage-drivers), `auth/`         |
| file                      | `@xtandard/webhooks/storage/file`          | [`elysia/`](./elysia), [`split-worker/`](./split-worker) |
| redis                     | `@xtandard/webhooks/storage/redis`         | [`postgres-redis/`](./postgres-redis) (queue plane)      |
| postgres                  | `@xtandard/webhooks/storage/postgres`      | [`postgres-redis/`](./postgres-redis) (control plane)    |
| mongodb                   | `@xtandard/webhooks/storage/mongodb`       | `storage-drivers/` (behind `MONGO_URL`)                  |
| sqlite (`bun:sqlite`)     | `@xtandard/webhooks/storage/sqlite`        | Bun-only single-node persistence                         |
| libsql / Turso            | `@xtandard/webhooks/storage/libsql`        | same SQL over the network / replicated                   |
| cloudflare-kv             | `@xtandard/webhooks/storage/cloudflare-kv` | Workers KV binding                                       |
| unstorage (dozens more)   | `@xtandard/webhooks/storage/unstorage`     | bridge to Upstash, S3, Vercel KV, …                      |
| drizzle (pg/mysql/sqlite) | `@xtandard/webhooks/storage/drizzle`       | reuse your app's existing Drizzle database               |

These examples depend on the package via `file:../..`, so they run against
your local checkout. **Build the package once at the repo root first** (the
bundled UI and `dist/` must exist):

```bash
cd ..            # repo root
bun install
bun run build    # builds dist/ (lib) + dist/ui (admin SPA)
```

When using the published package instead, swap the dependency for
`"@xtandard/webhooks": "^0.1.0"`.

## Run from the repo root (auto-install + free port)

From the repo root, after `bun run build`, convenience scripts install the
example on first use and launch it on a **free port** (via `get-port-please`,
so you can run several at once without collisions):

```bash
bun run examples:elysia            # or: hono | express
bun run examples:full-loop         # publish → fail → retry → verified, in one command
bun run examples:auth              # AUTH_DEMO=none|basic|delegated|rbac
bun run examples:storage-drivers   # script example (no server)
bun run examples:split-worker      # boots the web process AND the worker
```

Each prints the URL it chose, e.g. `> elysia → http://localhost:3001/webhooks`.

The polyglot [`receivers/`](./receivers) run with their own toolchains — see
that folder's README.

## The flagship demo

For a fully seeded panel (two applications, endpoints with distinct delivery
personalities, live retries and dead-letters), run the demo from the repo
root instead:

```bash
bun run demo                       # → http://localhost:7789
```
