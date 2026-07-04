# ADR 0005 — Storage = KV Contract + Due Index + Optional deliveryQueue Capability

**Status:** Accepted

---

## Context

The product promise is "point it at the database you already run". `@xtandard/flags` proved that a four-method KV contract (`getItem`, `setItem`, `removeItem`, `getKeys`) plus feature-detected optional capabilities ports to ten backends nearly mechanically.

Webhooks add a genuinely new requirement the flags contract has no answer for: a **work queue**. The dispatcher must repeatedly find "deliveries due at or before now", claim them exclusively, and re-schedule them — something purpose-built queue backends do natively (Redis sorted sets, SQL `SKIP LOCKED`), but a plain KV cannot express directly.

The alternatives:

- **Require a queue-capable backend** — kills the "your existing DB" promise.
- **Extend the base contract with queue methods** — every adapter (including Cloudflare KV) must implement scheduling primitives it doesn't have.
- **Encode the queue in keys + add an optional capability** — a _due-index key convention_ every KV can store, plus an optional `deliveryQueue` capability that backends with native primitives implement for efficiency and multi-instance safety.

---

## Decision

1. Keep the four-method `WebhooksStorage` contract and the flags capability set (`watch`, `transaction`, `compareAndSwap`) verbatim.
2. Encode the queue as a **due index**: `whk/{app}/due/{13-digit zero-padded millis}~{deliveryId}`. Zero-padded milliseconds make lexicographic order chronological, so a sorted `getKeys` scan yields due order on every backend. Exactly one due entry exists per non-terminal delivery: at `nextAttemptAt` while pending, at `leaseUntil` while claimed (so a crashed claimer's work re-surfaces automatically at lease expiry).
3. Add one optional capability, `DeliveryQueueStorage.claimDue({ now, limit, leaseMs })`, implemented natively only where it is cheap and better: **memory** (trivial) and **redis** (sorted set). Everything else uses the generic fallback in `core.claimDueDeliveries`: due-index scan + `compareAndSwap` claiming when available, plain read-modify-write otherwise (single-dispatcher assumption, documented).
4. No SQL `SKIP LOCKED` paths in v1 — the capability interface leaves that door open without building it now.

The per-app due scan is O(applications) per tick — acceptable at library scale; a global due index is a later optimization if real usage demands it.

---

## Consequences

- Every flags storage adapter ports with renames; only redis grows real new code.
- Multi-instance deployments need `claimDue` or `compareAndSwap` storage for exclusive claiming; with plain KV, run exactly one dispatcher.
- Deliveries and the due index can live in a different store than control data (`queueStorage` option): control in Postgres, queue in Redis.
