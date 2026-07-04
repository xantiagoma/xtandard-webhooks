/**
 * Elysia + @xtandard/webhooks — admin panel AND an app route that publishes.
 *
 *   bun add elysia @xtandard/webhooks
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
import { Elysia } from "elysia";
import { webhooksPanel } from "@xtandard/webhooks/elysia";
import { createFileStorage } from "@xtandard/webhooks/storage/file";
import { renderDemoPage, seedIfEmpty } from "./demo.ts";

const port = Number(process.env.PORT) || 3000;

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

new Elysia()
  .get(
    "/",
    () =>
      new Response(renderDemoPage(), {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
  )
  .post("/signup", async ({ body }) => {
    const email = (body as { email?: string } | undefined)?.email ?? "ada@example.com";
    // The see-it loop: a user action in YOUR app publishes; the dispatcher
    // (running inside the panel) fans out + delivers + retries on its own.
    const result = await panel.core.publish("acme", {
      eventType: "user.created",
      payload: { userId: `usr_${crypto.randomUUID().slice(0, 8)}`, email },
    });
    return {
      messageId: result.message.id,
      deliveriesQueued: result.deliveries.length,
      hint:
        result.deliveries.length === 0
          ? "no endpoints yet — add one in /webhooks, then sign up again"
          : "open /webhooks → acme → Deliveries to watch it land",
    };
  })
  .mount("/webhooks", panel)
  .listen(port);

console.log(`Elysia listening on http://localhost:${port} (signup at /, panel at /webhooks)`);
