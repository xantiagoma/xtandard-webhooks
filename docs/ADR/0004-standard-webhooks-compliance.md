# ADR 0004 — Standard Webhooks Compliance

**Status:** Accepted

---

## Context

Every webhook sender must answer: what headers, what signature scheme, what envelope? The options:

- **Custom scheme** — maximum flexibility, zero ecosystem. Every receiver team writes bespoke verification code, badly.
- **Svix-compatible headers** (`svix-id`, `svix-timestamp`, `svix-signature`) — piggybacks on Svix SDKs but ties us to a vendor's namespace.
- **Standard Webhooks** (https://www.standardwebhooks.com) — the open specification (`webhook-id`, `webhook-timestamp`, `webhook-signature`, `whsec_` secrets, `v1,` HMAC-SHA256 signatures) with official verification libraries in Python, Go, Ruby, Java, Rust, and more. Svix itself co-authored and follows it.

This package rides Standard Webhooks the way `@xtandard/flags` rides OpenFeature/OFREP: the open contract is the product's interoperability story.

---

## Decision

Implement Standard Webhooks symmetric (v1) signing exactly: signed content `${id}.${timestamp}.${body}`, base64 HMAC-SHA256, space-separated multi-signatures during rotation, timestamp tolerance both directions. The spec's own reference vector is a permanent known-answer test in `test/signing.test.ts`.

Declined:

- **Svix-compat header aliases** — receivers using official `standardwebhooks` libraries don't need them, and double headers invite skew bugs. (Svix emits both header sets; verifiers reading `webhook-*` work against Svix already.)
- **Custom envelope fields** — the recommended `{ type, timestamp, data }` shape is enough; host metadata belongs inside `data`.
- **Publishing our own polyglot verification libraries** — compliance means the official libraries verify our deliveries out of the box; `examples/receivers/` proves it instead.

`@xtandard/webhooks/receiver` ships anyway (zero-dep `verifyWebhook`) because TypeScript receivers deserve first-party ergonomics — and it verifies _any_ compliant sender, which is an adoption wedge.

---

## Consequences

- Receiver teams integrate with library code they may already run.
- Asymmetric signing (`v1a`, ed25519) is a future additive, already namespaced by the spec.
- We cannot change wire details without leaving the standard — that is the point.
