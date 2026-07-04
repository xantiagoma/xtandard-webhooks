# ADR 0008 — `webhook-id` Is the Message Id

**Status:** Accepted

---

## Context

Standard Webhooks defines `webhook-id` as "the unique identifier of the webhook" and prescribes that receivers use it as their **idempotency key**: retries of the same event must carry the same id so a receiver that already processed it can skip duplicates.

Internally this package has three candidate identifiers per HTTP request: the message id (`msg_…`, one per published event), the delivery id (`dlv_…`, one per message × endpoint), and the attempt id (`atp_…`, one per HTTP call).

---

## Decision

`webhook-id` carries the **message id**, always. Every retry of every delivery of a message sends the identical `webhook-id`, and the envelope bytes are the message's envelope serialized once at publish time — so both the id and the signed content are stable across the entire retry schedule.

The attempt-specific facts live where the spec puts them: `webhook-timestamp` is the time of _this_ attempt (receivers check tolerance against it), and the signature is computed per attempt over `${id}.${timestamp}.${body}`.

Why not the delivery id? Two endpoints of the same application receiving the same event would then see different ids for one logical event — defensible, but it weakens cross-system correlation ("which event was this?") and diverges from how Svix populates the header (message id), which is the behavior receiver-side dedupe caches are built around. Endpoint scoping already exists naturally: a receiver only ever sees its own endpoint's traffic.

---

## Consequences

- At-least-once duplicates (ADR 0002) are receiver-deduplicable with a single `webhook-id` cache.
- Send-example test deliveries mint a fresh synthetic `msg_…` id so they never collide with real dedupe caches.
- The message id is receiver-visible; ids are 128-bit crypto-random base62, so they leak no ordering or volume information.
