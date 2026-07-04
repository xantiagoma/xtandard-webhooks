# Signing

`@xtandard/webhooks` is **Standard Webhooks compliant** (https://www.standardwebhooks.com), symmetric scheme v1. That is a compatibility statement with teeth: any receiver using an official `standardwebhooks` library — Python, Go, Ruby, Java, Rust, C#, PHP, JavaScript — verifies deliveries from this package unmodified, and `@xtandard/webhooks/receiver` verifies webhooks from any compliant sender (Svix included). The spec's own reference vector is a permanent known-answer test in `test/signing.test.ts`.

## The wire contract

```txt
POST <endpoint.url>
content-type: application/json
webhook-id: msg_2yZyUqGox36AkC1nsjHqvxhAZgy    ← message id, stable across retries
webhook-timestamp: 1720000000                   ← unix seconds, of THIS attempt
webhook-signature: v1,K5oZfzN95Z9UVu1EsfQmfVNQhnkZ2pj9o9NDN/H/pI4= [v1,… during rotation]

{"type":"invoice.paid","timestamp":"2026-07-04T12:00:00.000Z","data":{…}}
```

- Secrets are `whsec_` + base64 key material (24 bytes generated; 24–64 accepted).
- The signed content is `${webhook-id}.${webhook-timestamp}.${raw body}`.
- The signature is `v1,` + base64(HMAC-SHA256(key, signed content)).
- During secret rotation the header carries one signature per unexpired secret, space-separated; a receiver accepts if **any** matches.

## Verifying (TypeScript, this package)

```ts
import { verifyWebhook, WebhookVerificationError } from "@xtandard/webhooks/receiver";

export async function handler(request: Request): Promise<Response> {
  try {
    const event = await verifyWebhook(request, process.env.WEBHOOK_SECRET!);
    // event.type, event.timestamp, event.data — verified
    return new Response("ok");
  } catch (err) {
    if (err instanceof WebhookVerificationError) return new Response("nope", { status: 401 });
    throw err;
  }
}
```

Rules the verifier enforces (all from the spec): raw-body verification (never re-serialize), case-insensitive headers, constant-time comparison, timestamp tolerance in **both** directions (default 300s), only `v1,` entries considered.

## Verifying (official libraries, other languages)

```python
# pip install standardwebhooks
from standardwebhooks.webhooks import Webhook

wh = Webhook(secret)  # "whsec_…"
payload = wh.verify(request.body, request.headers)  # raises on failure
```

```go
// go get github.com/standard-webhooks/standard-webhooks/libraries/go
wh, _ := standardwebhooks.NewWebhook(secret)
err := wh.Verify(body, headers)
```

`examples/receivers/` runs both against a live dispatcher as the interop proof.

## Sender-side details

- `attemptDelivery` signs with **all unexpired secrets** of the endpoint, so rotation is seamless: after `rotateSecret`, the old secret keeps verifying (and keeps being sent) until the grace window (`secretRotationGrace`, default 24h) elapses.
- The envelope body is serialized once at publish time and stored on the message — retries send byte-identical payloads, so a receiver may cache verification results by `webhook-id`.
- Endpoints cannot override `webhook-id`/`webhook-timestamp`/`webhook-signature` via static headers; validation rejects those names.

## Low-level API (`@xtandard/webhooks/signing`)

| Export                                                          | Purpose                                             |
| --------------------------------------------------------------- | --------------------------------------------------- |
| `generateSecret()`                                              | mint `whsec_` + 24 random bytes                     |
| `sign(secret, id, timestamp, body)`                             | one `v1,…` signature                                |
| `signatureHeader(secrets, id, timestamp, body)`                 | the full (possibly multi-) header value             |
| `verify({ payload, headers, secret, toleranceSeconds?, now? })` | full verification → parsed envelope                 |
| `WebhookVerificationError`                                      | thrown on any verification failure (`err.name` set) |

Zero dependencies, Web Crypto only — works in Bun, Node ≥ 20, Deno, and Workers.
