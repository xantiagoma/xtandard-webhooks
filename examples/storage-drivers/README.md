# Storage drivers × @xtandard/webhooks

One contract, every backend: `WebhooksStorage` is four async methods
(`getItem` / `setItem` / `removeItem` / `getKeys`), and every adapter satisfies
exactly that — so they are interchangeable as the control-plane store and the
delivery queue.

## What's here

A single script that runs the **identical end-to-end loop** against each
available backend:

```
create app → create event type → create endpoint → publish →
dispatch → assert exactly one signed request arrived → verify the signature
```

| Backend  | Import                                | Runs when                           |
| -------- | ------------------------------------- | ----------------------------------- |
| memory   | `@xtandard/webhooks/storage/memory`   | always                              |
| file     | `@xtandard/webhooks/storage/file`     | always                              |
| redis    | `@xtandard/webhooks/storage/redis`    | `REDIS_URL` set (`bun add redis`)   |
| postgres | `@xtandard/webhooks/storage/postgres` | `DATABASE_URL` set (`bun add pg`)   |
| mongodb  | `@xtandard/webhooks/storage/mongodb`  | `MONGO_URL` set (`bun add mongodb`) |

Also available with the same contract: `sqlite` (`bun:sqlite`), `libsql`
(Turso), `unstorage` (dozens of drivers), `cloudflare-kv`, and `drizzle`
(pg/mysql/sqlite).

## Run it

```bash
bun install
bun run start                                       # memory + file

# include the network backends (each needs its peer dep):
bun add redis && REDIS_URL=redis://localhost:6379 bun run start
bun add pg && DATABASE_URL=postgres://localhost:5432/postgres bun run start
```

## The loop

Each backend prints one line:

```
  OK memory     publish → deliver → signature verified
  OK file       publish → deliver → signature verified
  OK redis      publish → deliver → signature verified
```

The delivery target is `createTestReceiver` from `@xtandard/webhooks/testing`
(a real local HTTP server), the dispatcher is driven manually with
`drainDeliveries` (no timers), and the received request's signature is checked
with `verify` — so a green line means the WHOLE pipeline worked over that
backend, not just reads and writes.

Because the control plane and the delivery queue are separate options
(`storage` / `queueStorage`), you can also mix backends — see
[`../postgres-redis`](../postgres-redis) for the split-plane topology.

## Files

- [`src/index.ts`](./src/index.ts) — the loop, run per backend behind env guards.
