/**
 * Split planes: control-plane data in Postgres, the delivery queue in Redis.
 *
 *   docker compose up -d
 *   bun run src/index.ts
 *
 * Then:
 *   - GET  /        → the admin panel (reads/writes Postgres; deliveries in Redis).
 *   - POST /order   → publishes an `order.placed` message (fan-out into Redis).
 *
 * Why split? The control plane (applications, endpoints, messages, audit) is
 * your durable, queryable system of record — Postgres. The delivery queue
 * (deliveries, attempts, the due index) is hot, high-churn coordination state
 * the dispatcher hammers every second — Redis. Each backend does what it is
 * best at, configured with two options: `storage` + `queueStorage`.
 */
import { webhooksPanel } from "@xtandard/webhooks/bun";
import { createPostgresStorage } from "@xtandard/webhooks/storage/postgres";
import { createRedisStorage } from "@xtandard/webhooks/storage/redis";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://webhooks:webhooks@localhost:5432/webhooks";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

const panel = webhooksPanel({
  title: "Acme Webhooks (pg + redis)",
  // Control plane → Postgres (the adapter creates its table on first use).
  storage: createPostgresStorage({ connectionString: DATABASE_URL }),
  // Delivery queue → Redis.
  queueStorage: createRedisStorage({ url: REDIS_URL, prefix: "xtandard:webhooks:queue" }),
});

// Idempotent seed so POST /order works out of the box.
if (!(await panel.core.getApplication("acme"))) {
  await panel.core.createApplication({ key: "acme", name: "Acme Inc." });
}
await panel.core.upsertEventType({
  name: "order.placed",
  groupName: "Orders",
  description: "A new order was placed.",
});

const port = Number(process.env.PORT) || 3000;
Bun.serve({
  port,
  fetch: async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/order" && request.method === "POST") {
      const result = await panel.core.publish("acme", {
        eventType: "order.placed",
        payload: { orderId: `ord_${crypto.randomUUID().slice(0, 8)}`, totalCents: 12_900 },
      });
      return Response.json({
        messageId: result.message.id, // ← durable in Postgres
        deliveriesQueued: result.deliveries.length, // ← queued in Redis
      });
    }
    return panel.fetch(request);
  },
});

console.log(`Panel on http://localhost:${port} — control plane: Postgres, queue: Redis`);
console.log(`Publish something:  curl -s -X POST localhost:${port}/order`);
