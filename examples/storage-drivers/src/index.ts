/**
 * One contract, every backend.
 *
 *   bun run src/index.ts
 *
 * `WebhooksStorage` is four async methods (getItem/setItem/removeItem/getKeys).
 * Every adapter below satisfies exactly that, so any of them can back the
 * whole product — control plane AND delivery queue. This script proves it by
 * running the SAME end-to-end loop against each available backend:
 *
 *   create app → create event type → create endpoint → publish →
 *   dispatch (drain) → assert the receiver got exactly one signed request →
 *   verify the signature.
 *
 * memory + file always run. Network backends join in when their env URL is
 * set (each needs its peer dep installed first):
 *
 *   REDIS_URL=redis://localhost:6379          bun add redis
 *   DATABASE_URL=postgres://localhost/db      bun add pg
 *   MONGO_URL=mongodb://localhost:27017       bun add mongodb
 */
import { createDispatcher, createWebhooksCore, verify } from "@xtandard/webhooks";
import type { WebhooksStorage } from "@xtandard/webhooks";
import { createTestReceiver, drainDeliveries } from "@xtandard/webhooks/testing";

/** Unique per-run namespace so repeated runs never collide in shared stores. */
const RUN = `run${Date.now().toString(36)}`;

/** The same publish → deliver → verify loop, against any backend. */
async function exercise(name: string, storage: WebhooksStorage): Promise<void> {
  const receiver = await createTestReceiver();
  const core = createWebhooksCore({
    storage,
    allowInsecureUrls: true, // the test receiver is plain-http localhost
    dispatcher: { retrySchedule: ["0s", "0s", "0s"] },
  });
  const dispatcher = createDispatcher(core); // NOT started — we drive it manually

  try {
    await core.createApplication({ key: "acme", name: "Acme Inc." });
    await core.upsertEventType({ name: "invoice.paid", groupName: "Billing" });
    const endpoint = await core.createEndpoint("acme", { url: receiver.url });
    const secret = (await core.getSecrets("acme", endpoint.id))[0]?.secret ?? "";

    await core.publish("acme", {
      eventType: "invoice.paid",
      payload: { invoiceId: "inv_1", backend: name },
    });
    await drainDeliveries(dispatcher);

    const request = receiver.requests[0];
    if (!request) throw new Error("no delivery arrived");
    const envelope = await verify({ payload: request.body, headers: request.headers, secret });
    if (envelope.type !== "invoice.paid") throw new Error(`wrong event type: ${envelope.type}`);

    console.log(`  OK ${name.padEnd(10)} publish → deliver → signature verified`);
  } finally {
    await receiver.close();
  }
}

console.log("One contract, every backend:\n");

// ── Memory (no deps) ────────────────────────────────────────────────────────
{
  const { createMemoryStorage } = await import("@xtandard/webhooks/storage/memory");
  await exercise("memory", createMemoryStorage());
}

// ── File (no deps) ──────────────────────────────────────────────────────────
{
  const { createFileStorage } = await import("@xtandard/webhooks/storage/file");
  await exercise("file", createFileStorage({ dir: `./.webhooks/${RUN}` }));
}

// ── Redis  ·  bun add redis ─────────────────────────────────────────────────
if (process.env.REDIS_URL) {
  const { createRedisStorage } = await import("@xtandard/webhooks/storage/redis");
  await exercise(
    "redis",
    createRedisStorage({ url: process.env.REDIS_URL, prefix: `xtandard:webhooks:${RUN}` }),
  );
} else {
  console.log("  -- redis      skipped (set REDIS_URL to include it)");
}

// ── Postgres  ·  bun add pg ─────────────────────────────────────────────────
if (process.env.DATABASE_URL) {
  const { createPostgresStorage } = await import("@xtandard/webhooks/storage/postgres");
  await exercise(
    "postgres",
    createPostgresStorage({
      connectionString: process.env.DATABASE_URL,
      table: `xtandard_webhooks_${RUN}`,
    }),
  );
} else {
  console.log("  -- postgres   skipped (set DATABASE_URL to include it)");
}

// ── MongoDB  ·  bun add mongodb ─────────────────────────────────────────────
if (process.env.MONGO_URL) {
  const { createMongoStorage } = await import("@xtandard/webhooks/storage/mongodb");
  await exercise(
    "mongodb",
    createMongoStorage({ url: process.env.MONGO_URL, collectionName: `webhooks_${RUN}` }),
  );
} else {
  console.log("  -- mongodb    skipped (set MONGO_URL to include it)");
}

// Also available, same contract: sqlite (bun:sqlite), libsql/Turso, unstorage
// (dozens of drivers), cloudflare-kv (Workers binding), and drizzle (pg/mysql/
// sqlite). And because control plane and queue are SEPARATE options, you can
// split them: see ../postgres-redis.
console.log("\nEvery backend ran the identical loop — that is the whole point.");
process.exit(0);
