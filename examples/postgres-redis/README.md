# postgres-redis × @xtandard/webhooks

**Split planes** — the production topology: control-plane data in Postgres,
the delivery queue in Redis. Two storage options, each backend doing what it
is best at.

## What's here

| Plane                     | Backend  | Holds                                                 | Why                                                       |
| ------------------------- | -------- | ----------------------------------------------------- | --------------------------------------------------------- |
| `storage` (control)       | Postgres | applications, event types, endpoints, messages, audit | durable, transactional, queryable — your system of record |
| `queueStorage` (delivery) | Redis    | deliveries, attempts, the due index                   | hot, high-churn state the dispatcher polls every second   |

- **`GET /`** — the admin panel over both stores.
- **`POST /order`** — publishes an `order.placed` message: the message lands
  in Postgres, the fan-out deliveries land in Redis, and the dispatcher works
  them from there.

## Run it

```bash
docker compose up -d          # start postgres + redis
bun install
bun run start                 # honors PORT; defaults to 3000
```

Stop with `docker compose down` (add `-v` to wipe the data).

## The loop

1. Open <http://localhost:3000> → application **acme** → add an endpoint.
2. `curl -s -X POST localhost:3000/order` — the response shows the message id
   (Postgres) and the deliveries queued (Redis).
3. Watch the delivery land in the panel. Inspect the planes directly if you
   like: the `xtandard_webhooks` table in Postgres, and
   `KEYS 'xtandard:webhooks:queue:*'` in Redis.

## Configuration

Both connection strings come from the environment, with localhost defaults
that match `docker-compose.yml`:

```bash
DATABASE_URL=postgres://webhooks:webhooks@localhost:5432/webhooks
REDIS_URL=redis://localhost:6379
```

The Postgres adapter creates its key/value table (`CREATE TABLE IF NOT
EXISTS`) on first use; the Redis adapter prefixes its keys with
`xtandard:webhooks:queue`.

> The example needs the `pg` and `redis` peer dependencies — `bun install`
> here pulls them in.

To take the split one step further — a web process that only publishes and a
separate worker that only delivers — see [`../split-worker`](../split-worker).

## Files

- [`src/index.ts`](./src/index.ts) — the two-plane wiring, the seed, and the publish route.
- [`docker-compose.yml`](./docker-compose.yml) — postgres + redis with matching defaults.
