# Full loop × @xtandard/webhooks

Both sides of a webhook in one command: a sender (core + dispatcher) and a
verifying receiver, with the receiver deliberately failing the first two
attempts — so you watch the retry schedule recover in real time.

## What's here

- **`src/start.ts`** — the sender: an in-memory core with a compressed retry
  schedule (`0s, 2s, 4s`), a started dispatcher, and a single
  `core.publish("acme", { eventType: "order.completed", … })`. An `onDelivery`
  tap logs every attempt.
- **`src/receiver.ts`** — the receiver: a local HTTP server whose handler is
  the three lines every consumer writes — `verifyWebhook(request, secret)` from
  `@xtandard/webhooks/receiver` — plus a `failFirst: 2` switch that answers 500
  twice before accepting.

## Run it

```bash
bun install                 # links @xtandard/webhooks
bun run start
```

## The loop

1. The sender publishes one `order.completed` message. `publish()` returns
   immediately — it only enqueues.
2. Attempt 1 hits the receiver, which answers **500**. The dispatcher schedules
   a retry in ~2s.
3. Attempt 2 fails the same way; the next retry waits ~4s.
4. Attempt 3 lands. The receiver verifies the Standard Webhooks signature and
   prints the envelope; the sender prints the full attempt history — same
   `webhook-id` on every attempt, which is what receivers dedupe on.

Expected output (timings approximate):

```
[attempt #1] order.completed → 500 (will retry)
[attempt #2] order.completed → 500 (will retry)
[attempt #3] order.completed → 200 (delivered)
```

In production the default schedule stretches from seconds to hours
(`0s, 5s, 5m, 30m, 2h, 5h, 10h`) before a delivery dead-letters — this example
compresses it so the whole story plays out in about seven seconds.

## Files

- [`src/start.ts`](./src/start.ts) — sender wiring, publish, attempt log, final report.
- [`src/receiver.ts`](./src/receiver.ts) — the verifying (and initially failing) receiver.
