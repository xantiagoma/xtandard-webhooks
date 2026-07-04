/**
 * The Playwright e2e server: an in-memory panel + a real in-process test
 * receiver, booted by playwright.config.ts's webServer. Run under Bun:
 *
 *   bun e2e/server.ts
 *
 * Seeds one application ("acme"), a small event-type catalog, and one endpoint
 * pointing at the test receiver. The dispatcher runs with a fast retry
 * schedule so the dead-letter journey completes in seconds.
 *
 * Test-only routes (outside the panel):
 *   GET /healthcheck             → 200 (webServer readiness probe)
 *   GET /e2e/receiver            → { url }  the in-process receiver's URL
 *   GET /e2e/portal-token?app=X  → { token } a freshly minted portal token
 */

import {
  createFetchHandler,
  createPortalToken,
  createWebhooksCore,
  type DispatcherOptions,
} from "../src/index.ts";
import { createMemoryStorage } from "../src/storage/memory.ts";
import { createTestReceiver } from "../src/testing.ts";

const PORT = Number(process.env.PORT ?? 3311);
const PORTAL_SECRET = "e2e-portal-secret";

// Fast delivery loop: three attempts, sub-second delays, tight polling — an
// unreachable endpoint dead-letters within a few seconds.
const dispatcherOptions: DispatcherOptions = {
  pollIntervalMs: 200,
  retrySchedule: ["0s", "500ms", "1s"],
  timeoutMs: 3_000,
  autoDisable: false,
};

const storage = createMemoryStorage();
const core = createWebhooksCore({
  storage,
  allowInsecureUrls: true, // the test receiver is local http
  dispatcher: dispatcherOptions,
});

const receiver = await createTestReceiver();

// Seed: an application, a grouped event-type catalog, one healthy endpoint.
await core.createApplication({ key: "acme", name: "Acme Inc" });
await core.upsertEventType({
  name: "invoice.paid",
  description: "An invoice was paid in full.",
  groupName: "Billing",
});
await core.upsertEventType({
  name: "invoice.voided",
  description: "An invoice was voided.",
  groupName: "Billing",
});
await core.upsertEventType({
  name: "user.created",
  description: "A new user signed up.",
  groupName: "Users",
});
await core.createEndpoint("acme", {
  url: receiver.url,
  description: "Seeded e2e receiver",
});

const { fetch: panelFetch } = createFetchHandler({
  storage,
  core,
  dispatcher: dispatcherOptions,
  title: "@xtandard/webhooks e2e",
  portal: { secret: PORTAL_SECRET },
});

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/healthcheck") return json({ ok: true });
    if (url.pathname === "/e2e/receiver") return json({ url: receiver.url });
    if (url.pathname === "/e2e/portal-token") {
      const app = url.searchParams.get("app") ?? "acme";
      const expiresIn = url.searchParams.get("expiresIn") ?? "1h";
      const token = await createPortalToken(PORTAL_SECRET, app, {
        expiresIn: expiresIn as "1h",
      });
      return json({ token });
    }
    return panelFetch(request);
  },
});

console.log(`e2e server listening on http://localhost:${PORT} (receiver at ${receiver.url})`);
