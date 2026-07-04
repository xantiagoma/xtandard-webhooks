/**
 * One-command runner for the portal-embed example: boots a throwaway in-memory
 * panel on :3701 (seeded with one application, an event-type catalog, and an
 * endpoint), exposes a demo `/portal-token` mint route, then starts the Vite
 * host app.
 *
 *   bun run start          # → http://localhost:5190 (vite) + panel on :3701
 *   # or from the repo root: bun run examples:portal-embed
 *
 * Ctrl-C stops both. Nothing is persisted.
 */

import { createPortalToken } from "@xtandard/webhooks";
import { webhooksPanel } from "@xtandard/webhooks/bun";
import { createMemoryStorage } from "@xtandard/webhooks/storage/memory";

const PANEL_PORT = 3701; // must match the proxy target in vite.config.ts + PANEL_URL in src/App.tsx
const VITE_PORT = process.env.PORT ?? "5190";
const APPLICATION_KEY = "acme-customer";

// The portal secret NEVER reaches a browser — it only mints and verifies
// tokens server-side. Fixed here so the demo is reproducible.
const PORTAL_SECRET = "portal-embed-demo-secret-change-me";

const panel = webhooksPanel({
  storage: createMemoryStorage(),
  title: "Acme SaaS — webhooks",
  // A valid whpt_… bearer becomes a portal principal confined to its token's
  // application; /config then reports `portal: true` and the embedded shell
  // renders the reduced, application-pinned portal chrome.
  portal: { secret: PORTAL_SECRET },
  // The host app (Vite origin) calls the panel API cross-origin with a Bearer
  // token — no cookies, so no `credentials` needed.
  cors: {
    origin: (origin) =>
      origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:"),
  },
});

// Seed the tenant the portal token will be scoped to, so there is something to
// look at: an application, a small event catalog, and one endpoint.
await panel.core.createApplication({ key: APPLICATION_KEY, name: "Acme Customer" });
await panel.core.upsertEventType({ name: "invoice.paid", groupName: "Billing" });
await panel.core.upsertEventType({ name: "invoice.voided", groupName: "Billing" });
await panel.core.createEndpoint(APPLICATION_KEY, {
  url: "https://api.acme-customer.example/webhooks",
  description: "Acme Customer's production receiver",
  eventTypes: ["invoice.paid", "invoice.voided"],
});

const server = Bun.serve({
  port: PANEL_PORT,
  fetch: async (request) => {
    const url = new URL(request.url);
    // Simulates the HOST APP's backend: a session-guarded route that mints a
    // token for the signed-in customer's application. The Vite dev server
    // proxies /portal-token here so it looks same-origin to the frontend.
    if (url.pathname === "/portal-token" && request.method === "POST") {
      const token = await createPortalToken(PORTAL_SECRET, APPLICATION_KEY, { expiresIn: "1h" });
      return Response.json({ token, app: APPLICATION_KEY, expiresIn: "1h" });
    }
    return panel.fetch(request);
  },
});

console.log(
  `\n▶ portal-embed host app → http://localhost:${VITE_PORT} (panel on :${PANEL_PORT})\n`,
);
const vite = Bun.spawn(["bunx", "vite", "--port", VITE_PORT], {
  stdout: "inherit",
  stderr: "inherit",
});

const shutdown = () => {
  vite.kill();
  server.stop(true);
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await vite.exited;
shutdown();
