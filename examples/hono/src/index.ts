/**
 * Hono + @xtandard/webhooks — admin panel AND an app route that publishes.
 *
 *   bun add hono @xtandard/webhooks
 *   bun run src/index.ts
 *
 * Then:
 *   - GET  /          → a signup page; each signup publishes a webhook.
 *   - POST /signup    → `core.publish("acme", { eventType: "user.created", … })`.
 *   - GET  /webhooks  → the embedded admin panel (endpoints, deliveries, retries).
 *
 * The panel starts the delivery dispatcher in-process, so a published message
 * is signed and delivered to every subscribed endpoint moments later.
 */
import { Hono } from "hono";
import { webhooksPanel } from "@xtandard/webhooks/hono";
import { createFileStorage } from "@xtandard/webhooks/storage/file";
import { renderDemoPage, seedIfEmpty } from "./demo.ts";

// One store for everything (control plane + delivery queue). File storage
// survives restarts; swap for redis/postgres/… without touching the rest.
const storage = createFileStorage({ dir: "./.webhooks" });

const panel = webhooksPanel({
  basePath: "/webhooks",
  title: "Acme Webhooks",
  storage,
});

// Seed once on boot so /signup has an application + event type to publish to.
await seedIfEmpty(panel.core);

const app = new Hono();

app.get("/", (c) => c.html(renderDemoPage()));

app.post("/signup", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { email?: string };
  // The see-it loop: a user action in YOUR app publishes; the dispatcher
  // (running inside the panel) fans out + delivers + retries on its own.
  const result = await panel.core.publish("acme", {
    eventType: "user.created",
    payload: {
      userId: `usr_${crypto.randomUUID().slice(0, 8)}`,
      email: body.email ?? "ada@example.com",
    },
  });
  return c.json({
    messageId: result.message.id,
    deliveriesQueued: result.deliveries.length,
    hint:
      result.deliveries.length === 0
        ? "no endpoints yet — add one in /webhooks, then sign up again"
        : "open /webhooks → acme → Deliveries to watch it land",
  });
});

// The adapter returns a Hono sub-app, so it composes with `route()`.
app.route("/webhooks", panel);

const port = Number(process.env.PORT) || 3000;
console.log(`Hono listening on http://localhost:${port} (signup at /, panel at /webhooks)`);
export default { port, fetch: app.fetch };
