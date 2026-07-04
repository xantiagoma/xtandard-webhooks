# split-worker × @xtandard/webhooks

Separate the two planes into two **processes**: a web app that only publishes
(`dispatcher: false`) and a worker that only delivers. Deploys of your web app
never interrupt in-flight retries, and delivery throughput scales by adding
workers.

## What's here

- **`src/web.ts`** — panel + a `POST /signup` publish route, mounted with
  `dispatcher: false`. Publishes fan out into the shared storage and STAY
  PENDING — this process never performs delivery HTTP.
- **`src/worker.ts`** — `createDispatcher(core)` over the **same** storage,
  started and left running. This is exactly what the CLI's
  `xtandard-webhooks dispatch` command does.
- **`src/start.ts`** — boots both with one command, so you can watch their
  logs interleave.

Both processes share `./.webhooks` (file storage) here; in production point
them at the same Redis/Postgres instead — any backend works, and claims are
leased so multiple workers never double-send.

## Run it

```bash
bun install
bun run start               # web (honors PORT; defaults to 3000) + worker
```

Or each process in its own terminal — which is the actual production shape:

```bash
bun run web                 # terminal 1: publishes only
bun run worker              # terminal 2: delivers
```

The worker is also replaceable by the CLI, no code required:

```bash
STORAGE_DRIVER=file STORAGE_FILE_DIR=./.webhooks bunx xtandard-webhooks dispatch
```

## The loop

1. Start ONLY the web process (`bun run web`). Add an endpoint at
   <http://localhost:3000/webhooks> (application **acme**), then
   `curl -s -X POST localhost:3000/signup`.
2. In the panel, the delivery sits **pending** — nobody is delivering.
3. Start the worker (`bun run worker`). Within a second it claims the backlog,
   attempts it, and logs the outcome; the panel flips the delivery to
   delivered (or into the retry schedule if your endpoint is down).
4. Kill the worker mid-retry and restart it — the leased claim expires and the
   delivery is picked up again. At-least-once, process crashes included.

## Files

- [`src/web.ts`](./src/web.ts) — the publish-only web process (`dispatcher: false`).
- [`src/worker.ts`](./src/worker.ts) — the delivery worker (what `dispatch` runs).
- [`src/start.ts`](./src/start.ts) — one-command runner for both.
