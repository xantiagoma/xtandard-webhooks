# Polyglot receivers × @xtandard/webhooks

Verify webhooks sent by `@xtandard/webhooks` from **Python, Go, and
TypeScript** — the first two with the **official Standard Webhooks libraries**,
no vendor SDK. Because the wire format is the Standard Webhooks spec
(`webhook-id` / `webhook-timestamp` / `webhook-signature` + HMAC-SHA256), any
compliant library verifies our deliveries, and `@xtandard/webhooks/receiver`
verifies anyone else's (Svix included).

## What's here

| Receiver                      | Stack                                                                      | Verifies with                          |
| ----------------------------- | -------------------------------------------------------------------------- | -------------------------------------- |
| [`python/`](./python)         | FastAPI + [`standardwebhooks`](https://pypi.org/project/standardwebhooks/) | the official Python library            |
| [`go/`](./go)                 | `net/http` + `github.com/standard-webhooks/standard-webhooks/libraries/go` | the official Go library                |
| [`typescript/`](./typescript) | `Bun.serve`                                                                | bare `verifyWebhook` from `./receiver` |

Plus [`send.ts`](./send.ts) — the sending side: an in-memory core + dispatcher
pointed at whichever receiver you started. All parties share one well-known
demo secret (the example value from the Standard Webhooks spec), which
`send.ts` pins onto its endpoint so the receivers can verify.

> These are standalone projects with their own toolchains (an optional
> [`mise.toml`](./mise.toml) pins python/go — run `mise install` to use it) and
> are excluded from the repo's examples typecheck.

## Run it

**1. Start a receiver** (each listens on `:8000` by default; `PORT` overrides):

```bash
# Python (uv resolves deps from pyproject.toml)
cd python && uv run main.py

# Go
cd go && go mod tidy && go run .

# TypeScript
cd typescript && bun install && bun run main.ts
```

**2. Send to it** (from this folder):

```bash
bun install
bun run send.ts                                        # → http://localhost:8000/webhook
RECEIVER_URL=http://localhost:8100/webhook bun run send.ts
```

## The loop

1. `send.ts` creates an application, an event type, and an endpoint at
   `RECEIVER_URL`, pins the shared demo secret, starts a dispatcher, and
   publishes one `demo.ping`.
2. The dispatcher signs and POSTs the envelope — `webhook-id`,
   `webhook-timestamp`, `webhook-signature`, exactly per spec.
3. The receiver verifies with its official library and prints the envelope;
   `send.ts` reports the delivery as `succeeded`.
4. Try breaking it: change the receiver's `WEBHOOK_SECRET` and send again — the
   receiver answers 401, and you watch `send.ts` retry (1s, then 2s) and give
   up. That 401-on-bad-signature is the entire receiver-side contract.

## Files

- [`send.ts`](./send.ts) — the sender: core + dispatcher + pinned demo secret.
- [`python/main.py`](./python/main.py) / [`python/pyproject.toml`](./python/pyproject.toml) — FastAPI receiver.
- [`go/main.go`](./go/main.go) / [`go/go.mod`](./go/go.mod) — net/http receiver.
- [`typescript/main.ts`](./typescript/main.ts) — Bun receiver on `verifyWebhook`.
