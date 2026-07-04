/**
 * Express + @xtandard/webhooks — admin panel AND an app route that publishes.
 *
 *   bun add express @xtandard/webhooks
 *   bun run src/index.ts
 *
 * Then:
 *   - GET  /          → a signup page; each signup publishes a webhook.
 *   - POST /signup    → `core.publish("acme", { eventType: "user.created", … })`.
 *   - GET  /webhooks  → the embedded admin panel (endpoints, deliveries, retries).
 *
 * Mount the panel BEFORE any body-parsing middleware — it reads the raw body.
 *
 * The panel starts the delivery dispatcher in-process, so a published message
 * is signed and delivered to every subscribed endpoint moments later.
 */
import express from "express";
import { webhooksPanel } from "@xtandard/webhooks/express";
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

const app = express();

// Panel FIRST (it reads the raw request body), then your own parsers/routes.
app.use("/webhooks", panel);
app.use(express.json());

app.get("/", (_req, res) => {
  res.type("html").send(renderDemoPage());
});

app.post("/signup", (req, res) => {
  const email = (req.body as { email?: string } | undefined)?.email ?? "ada@example.com";
  // The see-it loop: a user action in YOUR app publishes; the dispatcher
  // (running inside the panel) fans out + delivers + retries on its own.
  panel.core
    .publish("acme", {
      eventType: "user.created",
      payload: { userId: `usr_${crypto.randomUUID().slice(0, 8)}`, email },
    })
    .then((result) => {
      res.json({
        messageId: result.message.id,
        deliveriesQueued: result.deliveries.length,
        hint:
          result.deliveries.length === 0
            ? "no endpoints yet — add one in /webhooks, then sign up again"
            : "open /webhooks → acme → Deliveries to watch it land",
      });
    })
    .catch((err: unknown) => {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () =>
  console.log(`Express on http://localhost:${port} (signup at /, panel at /webhooks)`),
);
