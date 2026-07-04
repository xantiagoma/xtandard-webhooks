# standalone-docker × @xtandard/webhooks

Run the standalone Docker image — panel, API, and delivery dispatcher in one
container — next to a Redis that holds both planes. No code, only environment
variables.

## What's here

- **`docker-compose.yml`** — `ghcr.io/xantiagoma/xtandard-webhooks` + `redis:7`,
  with basic auth and Redis storage configured via env.

## Run it

```bash
docker compose up
```

Then open <http://localhost:3000> and sign in with `admin` / `changeme`.

Everything is configured through the same env contract as the CLI's `serve`
command (`STORAGE_DRIVER`, `QUEUE_STORAGE_DRIVER`, `AUTH_MODE`,
`RETRY_SCHEDULE`, `DISPATCHER`, retention vars, …) — run
`npx @xtandard/webhooks help` for the full list. Generate a real password
hash with:

```bash
bun -e "import('@xtandard/webhooks/auth/basic').then(m => m.hashPassword('secret').then(console.log))"
```

and set it as `AUTH_PASSWORD_HASH` instead of `AUTH_PASSWORD`.

## The loop

1. Create an application, an event type, and an endpoint in the panel.
2. Publish from anywhere that can reach the container — your app via the API,
   or the CLI: `xtandard-webhooks publish --app acme --type invoice.paid
--data '{"invoiceId":"inv_1"}'` (pointed at the same Redis).
3. The in-container dispatcher delivers, retries, and dead-letters; the panel
   shows every attempt.

For the topology where the container publishes only and separate workers
deliver, set `DISPATCHER: "0"` here and run `xtandard-webhooks dispatch`
workers against the same Redis — see [`../split-worker`](../split-worker).

## Files

- [`docker-compose.yml`](./docker-compose.yml) — the two services, wired.
