# ADR 0007 — Retry Schedule and Auto-Disable Defaults

**Status:** Accepted

---

## Context

Retry policy is the heart of a delivery system's operational behavior. Too aggressive hammers struggling receivers; too lazy makes webhooks feel unreliable; unbounded retries turn dead endpoints into permanent load.

Svix's production-proven defaults are the de-facto industry baseline: attempts at 0s, 5s, 5m, 30m, 2h, 5h, 10h (≈17.5 hours of coverage), then dead-letter; endpoints failing consistently for multiple days get disabled.

---

## Decision

- **Default retry schedule** `["0s", "5s", "5m", "30m", "2h", "5h", "10h"]` — Svix-compatible on purpose: it covers transient blips (5s), deploys (5m/30m), and outages (hours) with only 7 attempts, and anyone migrating from Svix keeps identical behavior. Fully configurable per dispatcher (`retrySchedule`), with **±10% jitter** on every delay so synchronized failures don't retry in lockstep.
- **Exhaustion = dead-letter** (`status: "failed"`), never silent drop: visible in the UI, replayable via `retryDelivery`/`recoverEndpoint`, offloadable via the `delivery.exhausted` hook event.
- **Auto-disable** endpoints whose _every_ attempt has failed for **5 consecutive days** (any success clears the streak; configurable via `autoDisable: { failingForDays }`, or `false` to opt out). Matches Svix's disable window, keeps dead endpoints from consuming the retry budget forever, and emits `endpoint.auto-disabled` so hosts can notify the customer.
- Deliveries to **manually or auto-disabled endpoints are held, not failed** — re-enabling resumes them.

---

## Consequences

- Migrations from Svix keep operational muscle memory.
- A dead endpoint costs at most `schedule.length` attempts per message for at most `failingForDays` days.
- Jitter makes exact retry times non-deterministic by design; tests assert bounds, not instants.
