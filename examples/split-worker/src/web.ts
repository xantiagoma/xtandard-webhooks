/**
 * The WEB process: panel + publish route, with `dispatcher: false` — it never
 * performs delivery HTTP. Publishes only enqueue; a separate worker process
 * (src/worker.ts) drains the queue from the same storage.
 *
 *   bun run src/web.ts        # honors PORT; defaults to 3000
 */
import { webhooksPanel } from "@xtandard/webhooks/bun";
import { createFileStorage } from "@xtandard/webhooks/storage/file";

// The storage BOTH processes share. Swap for redis/postgres in production —
// any backend works as long as web and worker point at the same one.
const storage = createFileStorage({ dir: "./.webhooks" });

const panel = webhooksPanel({
  basePath: "/webhooks",
  title: "Acme Webhooks (split worker)",
  storage,
  // The split: this process publishes only. No dispatcher, no delivery HTTP,
  // nothing to drain on deploys — the worker owns all of that.
  dispatcher: false,
});

// Idempotent seed so POST /signup works out of the box.
if (!(await panel.core.getApplication("acme"))) {
  await panel.core.createApplication({ key: "acme", name: "Acme Inc." });
}
await panel.core.upsertEventType({ name: "user.created", groupName: "Users" });

const port = Number(process.env.PORT) || 3000;
Bun.serve({
  port,
  fetch: async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/signup" && request.method === "POST") {
      const result = await panel.core.publish("acme", {
        eventType: "user.created",
        payload: { userId: `usr_${crypto.randomUUID().slice(0, 8)}` },
      });
      return Response.json({
        messageId: result.message.id,
        deliveriesQueued: result.deliveries.length,
        note: "queued only — watch them stay pending until the worker runs",
      });
    }
    if (url.pathname === "/") {
      return new Response(
        "Split-worker demo. POST /signup publishes; the panel is at /webhooks.\n" +
          "Deliveries stay PENDING until the worker process picks them up.\n",
        { headers: { "content-type": "text/plain; charset=utf-8" } },
      );
    }
    return panel.fetch(request);
  },
});

console.log(`[web] publishing only (dispatcher: false) on http://localhost:${port}/webhooks`);
console.log(`[web] publish something:  curl -s -X POST localhost:${port}/signup`);
