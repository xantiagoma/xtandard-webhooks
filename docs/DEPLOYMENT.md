# Deployment

The three shapes (ADR 0002 / ARCHITECTURE.md), the standalone image, the full env contract, and the security posture you must read before going to production.

## Shapes

1. **Embedded** — panel + dispatcher inside your app (`webhooksPanel({ storage })`). One process, nothing extra to operate. With several app replicas, either give exactly one the dispatcher (`dispatcher: false` on the rest) or use claim-safe storage (redis `claimDue` / CAS-capable) so all may dispatch.
2. **Split worker** — the app publishes only (`dispatcher: false`); a worker runs `xtandard-webhooks dispatch` against the same storage. Keeps webhook egress off your web tier.
3. **Standalone** — the Docker image serves panel + dispatcher; apps publish over the API.

## Standalone / Docker

```sh
docker run -p 3000:3000 \
  -e STORAGE_DRIVER=redis -e REDIS_URL=redis://redis:6379 \
  -e AUTH_MODE=basic -e AUTH_USERNAME=ops -e AUTH_PASSWORD_HASH='<scrypt hash>' \
  -e PORTAL_SECRET='<random string>' \
  ghcr.io/xantiagoma/xtandard-webhooks
```

`/healthcheck` answers 200 for orchestrator probes. `examples/standalone-docker/` has a compose file; `examples/postgres-redis/` shows the split-plane setup.

## Environment variables (CLI `serve`/`dispatch` and the image)

| Variable                                                                 | Meaning                                                        | Default                                         |
| ------------------------------------------------------------------------ | -------------------------------------------------------------- | ----------------------------------------------- |
| `STORAGE_DRIVER` / `QUEUE_STORAGE_DRIVER`                                | `memory` `file` `redis` `postgres` `mongodb` `sqlite` `libsql` | `file` (standalone: `memory`) / same as storage |
| `REDIS_URL`, `STORAGE_PREFIX`/`QUEUE_PREFIX`                             | redis connection + key prefix                                  | —                                               |
| `DATABASE_URL` or `POSTGRES_URL`, `{STORAGE,QUEUE}_PG_TABLE`             | postgres                                                       | table `xtandard_webhooks`                       |
| `MONGO_URL`, `MONGO_DB`, `{STORAGE,QUEUE}_MONGO_COLLECTION`              | mongodb                                                        | —                                               |
| `{STORAGE,QUEUE}_FILE_DIR`                                               | file driver dirs                                               | `./.webhooks/{storage,queue}`                   |
| `{STORAGE,QUEUE}_SQLITE_PATH`, `LIBSQL_URL`/`LIBSQL_AUTH_TOKEN`          | sqlite / libsql                                                | —                                               |
| `PORT`, `BASE_PATH`, `TITLE`, `LOGO_URL`                                 | HTTP + branding                                                | `3000`, `/`, `@xtandard/webhooks`               |
| `READONLY`                                                               | mutations 403                                                  | `false`                                         |
| `AUTH_MODE`, `AUTH_USERNAME`, `AUTH_PASSWORD_HASH` (or `AUTH_PASSWORD`)  | `none`/`basic`                                                 | `none`                                          |
| `PORTAL_SECRET`                                                          | enables portal tokens                                          | off                                             |
| `DISPATCHER`                                                             | `0`/`false` disables the in-process dispatcher                 | on                                              |
| `RETRY_SCHEDULE`                                                         | comma list, e.g. `0s,5s,5m,30m,2h,5h,10h`                      | Svix-compatible default                         |
| `MESSAGE_KEEP_LAST`/`MESSAGE_MAX_AGE`, `AUDIT_KEEP_LAST`/`AUDIT_MAX_AGE` | retention                                                      | off                                             |

## Security posture — read this

- **Endpoint URLs and SSRF.** By default endpoint URLs must be `https` (localhost exempt for dev), may not carry credentials, and may not override the `webhook-*` headers. **There is no default SSRF egress protection beyond that**: an admin or portal user can register any URL, including ones that resolve into your private network, and the dispatcher will POST signed payloads at it. If untrusted parties can create endpoints (they can, via the portal), set `urlPolicy` with a real deny-list/allow-list for your network:

```ts
createWebhooksCore({
  storage,
  urlPolicy: (url) => !isPrivateAddress(new URL(url).hostname), // your resolver-aware check
});
```

- **Secrets at rest.** Endpoint signing secrets are stored in your storage backend **unencrypted** (like most self-hosted systems — the DB is the trust boundary). Encrypt the volume/DB, restrict `endpoint:read-secret` (viewers don't get it), and rotate on suspicion. An optional `secretCipher` hook for at-rest encryption is on the roadmap.
- **The panel is an admin surface.** `auth: none` is a quickstart default, not a deployment. Use basic/delegated auth + roles, or keep the panel off the public internet and expose only the portal.
- **Portal tokens are bearer credentials** — HTTPS only; rotation of `PORTAL_SECRET` is the revocation story (`docs/PORTAL.md`).
- **Cloudflare Workers**: the KV adapter works, but there is no long-lived process — schedule delivery with a cron trigger invoking `dispatcher.tick()`.

## Operational checklist

- [ ] Real storage driver + backups (the message log and secrets live there)
- [ ] Auth + authorization on the panel; `PORTAL_SECRET` set only if the portal is used
- [ ] `urlPolicy` if untrusted parties register endpoints
- [ ] Retention configured (`MESSAGE_*`/`AUDIT_*`) — message logs grow unboundedly otherwise
- [ ] `onDelivery` sink wired to metrics; `delivery.exhausted` hook wired to alerting
- [ ] One dispatcher per plain-KV storage; any number over redis/CAS storage
