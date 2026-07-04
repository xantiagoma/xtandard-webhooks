# Testing

Both how this repo is tested and what it ships for testing _your_ webhook wiring.

## Testing your app: `@xtandard/webhooks/testing`

```ts
import {
  createTestWebhooks,
  createTestReceiver,
  drainDeliveries,
} from "@xtandard/webhooks/testing";
import { test, expect } from "bun:test"; // or vitest

test("shipping an order emits order.shipped", async () => {
  const { core, dispatcher } = createTestWebhooks();
  await core.createApplication({ key: "acme" });
  await core.upsertEventType({ name: "order.shipped" });
  const endpoint = await core.createEndpoint("acme", { url: "http://127.0.0.1:9/tmp" });
  const secret = (await core.getSecrets("acme", endpoint.id))[0]!.secret;

  const receiver = await createTestReceiver({ secret, failFirst: 1 }); // exercise a retry
  await core.updateEndpoint("acme", endpoint.id, { url: receiver.url });

  await shipOrder(core, "o_1"); // your code, calling core.publish(...)
  await drainDeliveries(dispatcher);

  expect(receiver.received[0]).toMatchObject({ type: "order.shipped" });
  await receiver.close();
});
```

- `createTestWebhooks()` — in-memory core + a **not started** dispatcher (no timers), defaulting to an all-immediate retry schedule so failure paths drain in a few `tick()`s.
- `createTestReceiver({ secret?, failFirst?, status? })` — a real local HTTP server; with `secret` it verifies each request (invalid → 401) and collects parsed envelopes in `received`; `failFirst: n` fails the first n requests to exercise retries. `requests` holds every raw request either way.
- `drainDeliveries(dispatcher, maxTicks?)` — tick until a pass makes no attempts.

No timers, no sleeps, no network flakiness: the dispatcher's `tick()` exists precisely to be the deterministic test surface.

## How this repo is tested

| Layer               | Where                                               | Notes                                                                            |
| ------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------- |
| unit + integration  | `test/*.test.ts` via `vp test run` (vitest)         | flat dir; `retry: 2` absorbs live-backend scheduling flakes                      |
| Bun-runtime-only    | `test/*.bun.test.ts` via `bun test`                 | `bun:sqlite`, libsql, CLI serve                                                  |
| storage conformance | `test/storage-contract.ts`                          | one battery, every adapter; incl. due-index ordering + `claimDue` semantics      |
| live backends       | env-gated: `REDIS_URL`, `POSTGRES_URL`, `MONGO_URL` | always-on locally via pglite for postgres/drizzle-pg; CI runs service containers |
| browser e2e         | `e2e/` via Playwright                               | boots the standalone app with the built UI                                       |
| coverage            | `vp test run --coverage`, thresholds 92/85/90/92    | enforced in CI only                                                              |

Conventions worth copying:

- **Injectable clock** — the core takes `now: () => number`; tests advance a fake clock instead of sleeping (retry schedules, lease expiry, rotation grace, retention ages).
- **Injectable fetch** — the dispatcher takes `fetch`; `test/fixtures.ts` provides `fakeFetch(respond)` capturing every request for wire-contract assertions (headers, signatures verify, body bytes stable).
- **No timer assertions** — everything drives `tick()`; `start()`/`stop()` get exactly one smoke test.
- **UI logic policy** — pure functions in `src/ui/lib/*` are unit-tested; no jsdom/component tests; everything visual goes through Playwright.

Local gate (also the pre-push hook): `bun run check && bun run test && bun run test:bun`.
