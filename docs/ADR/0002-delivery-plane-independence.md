# ADR 0002 — Delivery-Plane Independence and At-Least-Once Semantics

**Status:** Accepted

---

## Context

A webhooks system has two very different workloads:

- **Control plane** — CRUD on applications, event types, and endpoints; browsing deliveries; replay. Rare, human-driven, guarded by hooks and audit.
- **Delivery plane** — `publish()` on the host's request path, plus the retrying HTTP delivery work. Hot, machine-driven, and failure-prone by design (the remote party is someone else's server).

If `publish()` performed HTTP calls, a slow or down customer endpoint would stall the host app's request handlers. If delivery state lived in memory, a crashed process would silently drop queued work.

---

## Decision

1. **`publish()` never performs an HTTP call and never throws because an endpoint is down.** It persists one message (with its wire envelope serialized exactly once) and fans out one `pending` delivery per matching enabled endpoint. Cost: one message write + N delivery writes.
2. **The dispatcher owns all network I/O**, retries, and failure accounting. It polls a persisted due index, claims deliveries with expiring leases, and drives each delivery's state machine (`pending → delivering → succeeded | failed`).
3. **Semantics are at-least-once.** A crashed process loses nothing: pending and claimed deliveries are persisted; leases expire; the next dispatcher tick (in any process) reclaims them. The cost is possible duplicates after a crash mid-attempt — receivers dedupe on `webhook-id` (ADR 0008).
4. **The admin UI is optional at runtime.** The dispatcher runs embedded in the host process, in a split worker (`xtandard-webhooks dispatch`), or in the standalone image — delivery never depends on the panel being mounted.

---

## Consequences

- Publishing from a request handler adds storage-write latency only.
- Exactly-once is explicitly _not_ promised; the receiver contract (Standard Webhooks) already expects idempotent handling by `webhook-id`.
- Multi-instance safety depends on the storage's claim primitive: native `claimDue` > compare-and-swap > plain read-modify-write (single-dispatcher assumption, documented in `docs/DELIVERY.md`).
