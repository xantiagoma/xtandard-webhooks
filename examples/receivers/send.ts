/**
 * The sending side for the polyglot receivers: boots an in-memory core +
 * dispatcher pointed at whichever receiver you started (Python, Go, or
 * TypeScript), publishes one `demo.ping`, and reports the outcome.
 *
 *   RECEIVER_URL=http://localhost:8000/webhook bun run send.ts
 *
 * All parties share one WELL-KNOWN demo secret (the example value from the
 * Standard Webhooks spec), so each receiver can verify with its official
 * library. Endpoint secrets are normally generated — here we pin the endpoint
 * to the demo secret by rewriting its storage record, which is exactly the
 * kind of thing the storage contract makes possible (and nothing you would do
 * in production).
 */
import { createDispatcher, createWebhooksCore, keys } from "@xtandard/webhooks";
import type { Endpoint } from "@xtandard/webhooks";
import { createMemoryStorage } from "@xtandard/webhooks/storage/memory";

export const DEMO_SECRET = process.env.WEBHOOK_SECRET ?? "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const RECEIVER_URL = process.env.RECEIVER_URL ?? "http://localhost:8000/webhook";

const storage = createMemoryStorage();
const core = createWebhooksCore({
  storage,
  dispatcher: { retrySchedule: ["0s", "1s", "2s"], pollIntervalMs: 250 },
  onDelivery: (event) => {
    const status = event.httpStatus ?? "network-error";
    const outcome = event.ok ? "accepted" : event.terminal ? "gave up" : "will retry";
    console.log(`[attempt #${event.attemptNumber}] → ${status} (${outcome})`);
  },
});

await core.createApplication({ key: "demo" });
await core.upsertEventType({ name: "demo.ping", description: "Polyglot interop ping." });
const endpoint = await core.createEndpoint("demo", { url: RECEIVER_URL });

// Pin the endpoint's (normally generated) signing secret to the shared demo
// secret so the receiver you started can verify the signature.
const endpointKey = keys.endpointKey("demo", endpoint.id);
const stored = await storage.getItem<Endpoint>(endpointKey);
if (!stored) throw new Error("endpoint vanished from storage");
await storage.setItem<Endpoint>(endpointKey, {
  ...stored,
  secrets: [{ secret: DEMO_SECRET, createdAt: new Date().toISOString() }],
});

const dispatcher = createDispatcher(core);
dispatcher.start();

const { message } = await core.publish("demo", {
  eventType: "demo.ping",
  payload: { hello: "from @xtandard/webhooks", language: "any", sentAt: new Date().toISOString() },
});
console.log(`Published ${message.id} → delivering to ${RECEIVER_URL}\n`);

// Wait for the delivery to reach a terminal state (3 fast attempts max).
let status = "pending";
const deadline = Date.now() + 15_000;
while (Date.now() < deadline) {
  const [delivery] = await core.listDeliveries("demo", { messageId: message.id });
  if (delivery && (delivery.status === "succeeded" || delivery.status === "failed")) {
    status = delivery.status;
    break;
  }
  await Bun.sleep(200);
}

await dispatcher.stop();

if (status === "succeeded") {
  console.log("\nDelivered and (receiver-side) verified. Interop proven.");
  process.exit(0);
}
console.error(`\nDelivery did not succeed (status: ${status}).`);
console.error(`Is a receiver listening at ${RECEIVER_URL}? Start one first — see README.md.`);
process.exit(1);
