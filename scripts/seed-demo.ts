/**
 * Seed a running `@xtandard/webhooks` server with a complete, representative
 * dataset — two applications, a grouped event-type catalog, endpoints with
 * distinct delivery personalities (healthy / flaky / always-failing /
 * disabled), ~40 published messages, a rotated secret, and an audit trail — so
 * the panel has something real to show.
 *
 * The endpoints point at a demo receiver ({@link startDemoReceiver}) that this
 * script boots when run standalone (`bun run demo` boots everything for you):
 *
 *   bun scripts/seed-demo.ts                 # seeds http://localhost:7789
 *   BASE_URL=http://localhost:3000 bun scripts/seed-demo.ts
 *
 * Seeding is fast by design: publishes only enqueue deliveries — the running
 * dispatcher then produces REAL attempt history (including retries and
 * dead-letters against the always-500 endpoint) live while you browse.
 *
 * @module
 */

import { createServer, type Server } from "node:http";

const DEFAULT_BASE = (process.env.BASE_URL ?? "http://localhost:7789").replace(/\/$/, "");

/** A running demo receiver. */
export interface DemoReceiver {
  /** Base URL — register endpoints at `${url}/healthy`, `/flaky`, `/down`. */
  url: string;
  close(): Promise<void>;
}

/**
 * A local HTTP server that plays the customers' receivers, with one
 * personality per path so the seeded endpoints produce distinct histories:
 *
 * - `/healthy` — always 200.
 * - `/flaky`   — 50% 200, 50% 503 (exercises the retry schedule).
 * - `/down`    — always 500 (exhausts the schedule → populated dead-letters).
 *
 * It never verifies signatures — it only shapes delivery outcomes.
 */
export async function startDemoReceiver(port = 0): Promise<DemoReceiver> {
  const server: Server = createServer((req, res) => {
    // Drain the body, then answer per the path's personality.
    req.resume();
    req.on("end", () => {
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      let status = 200;
      if (path === "/down") status = 500;
      else if (path === "/flaky" && Math.random() < 0.5) status = 503;
      res.writeHead(status, { "content-type": "text/plain" });
      res.end(status === 200 ? "ok" : "simulated failure");
    });
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("demo receiver failed to bind a port");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

/** Seed a complete demo dataset against the server at `base`. */
export async function seed(base: string = DEFAULT_BASE, receiverUrl: string): Promise<void> {
  const BASE = base.replace(/\/$/, "");
  let okCount = 0;
  const call = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
    }
    okCount++;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };

  console.log(`Seeding ${BASE} (receiver at ${receiverUrl}) …`);

  // --- Event-type catalog (~6 types across three groups) ---
  const eventTypes = [
    { name: "invoice.paid", groupName: "Billing", description: "An invoice was paid in full." },
    {
      name: "invoice.payment_failed",
      groupName: "Billing",
      description: "A payment attempt failed.",
    },
    { name: "user.created", groupName: "Users", description: "A new user signed up." },
    { name: "user.deleted", groupName: "Users", description: "A user deleted their account." },
    { name: "order.placed", groupName: "Orders", description: "A new order was placed." },
    {
      name: "order.shipped",
      groupName: "Orders",
      description: "An order left the warehouse.",
      schema: {
        type: "object",
        properties: { orderId: { type: "string" }, carrier: { type: "string" } },
      },
    },
  ];
  for (const et of eventTypes) await call("POST", "/api/event-types", et);

  // --- Two applications (multi-tenant) ---
  await call("POST", "/api/applications", { key: "acme", name: "Acme Inc." });
  await call("POST", "/api/applications", { key: "globex", name: "Globex Corp." });

  // --- Four endpoints per app, each with a delivery personality ---
  // healthy: subscribed to everything (empty subscription = all events).
  // flaky:   Billing + Orders — its 503s exercise the retry schedule.
  // down:    Users only — always 500, so its deliveries dead-letter.
  // disabled: created, then disabled (a held endpoint + an audit entry).
  interface EndpointOut {
    id: string;
  }
  const endpoints: Record<string, Record<string, string>> = {};
  for (const app of ["acme", "globex"]) {
    endpoints[app] = {};
    const create = async (label: string, input: Record<string, unknown>): Promise<EndpointOut> => {
      const ep = (await call("POST", `/api/applications/${app}/endpoints`, input)) as EndpointOut;
      endpoints[app]![label] = ep.id;
      return ep;
    };
    await create("healthy", {
      url: `${receiverUrl}/healthy`,
      description: "Production consumer — always up",
    });
    await create("flaky", {
      url: `${receiverUrl}/flaky`,
      description: "Fails ~half the time (watch the retries)",
      eventTypes: ["invoice.paid", "invoice.payment_failed", "order.placed", "order.shipped"],
    });
    await create("down", {
      url: `${receiverUrl}/down`,
      description: "Always 500 — exhausts the retry schedule into dead-letters",
      eventTypes: ["user.created", "user.deleted"],
    });
    const disabled = await create("disabled", {
      url: `${receiverUrl}/healthy`,
      description: "Paused consumer (deliveries held, not failed)",
      eventTypes: ["order.placed"],
    });
    await call("POST", `/api/applications/${app}/endpoints/${disabled.id}/disable`);
  }

  // --- A rotated secret (the old one keeps verifying through the grace window) ---
  await call("POST", `/api/applications/acme/endpoints/${endpoints.acme!.healthy}/rotate-secret`);

  // --- Extra audit trail: a disable/enable cycle + a couple of updates ---
  await call("POST", `/api/applications/acme/endpoints/${endpoints.acme!.flaky}/disable`);
  await call("POST", `/api/applications/acme/endpoints/${endpoints.acme!.flaky}/enable`);
  await call("PUT", `/api/applications/globex`, { name: "Globex Corporation" });
  await call("PUT", `/api/applications/acme/endpoints/${endpoints.acme!.healthy}`, {
    description: "Production consumer — always up (rotated secret)",
  });

  // --- ~40 messages of real history, spread across apps + event types ---
  // The dispatcher (running in the server) delivers these live: the healthy
  // endpoint succeeds immediately, the flaky one retries, the down one walks
  // the whole schedule into a dead-letter. We do NOT wait for any of that.
  const carriers = ["UPS", "DHL", "FedEx"];
  const plans = ["starter", "pro", "enterprise"];
  const publish = (app: string, eventType: string, payload: unknown, idempotencyKey?: string) =>
    call("POST", `/api/applications/${app}/messages`, {
      eventType,
      payload,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });

  for (let i = 1; i <= 8; i++) {
    for (const app of ["acme", "globex"]) {
      const n = app === "acme" ? i : i + 100;
      await publish(app, "user.created", {
        userId: `usr_${n}`,
        email: `user${n}@example.com`,
        plan: plans[n % plans.length],
      });
      await publish(app, "invoice.paid", {
        invoiceId: `inv_${n}`,
        amountCents: 1900 + n * 250,
        currency: "USD",
      });
    }
  }
  for (let i = 1; i <= 4; i++) {
    await publish(
      "acme",
      "order.placed",
      { orderId: `ord_${i}`, items: i, totalCents: i * 4200 },
      `order-${i}`, // idempotency key: re-running the seed dedupes these
    );
    await publish("acme", "order.shipped", { orderId: `ord_${i}`, carrier: carriers[i % 3] });
    await publish("globex", "invoice.payment_failed", {
      invoiceId: `inv_${i + 200}`,
      reason: "card_declined",
    });
  }
  await publish("globex", "user.deleted", { userId: "usr_105", reason: "user request" });

  console.log(`Done — ${okCount} API calls.`);
  console.log("");
  console.log("  Applications: acme (Acme Inc.), globex (Globex Corporation).");
  console.log("  Event types: Billing (invoice.paid, invoice.payment_failed),");
  console.log("    Users (user.created, user.deleted), Orders (order.placed, order.shipped).");
  console.log("  Endpoints per app: healthy (all events), flaky (Billing+Orders, ~50% 503),");
  console.log("    down (Users, always 500 → dead-letters), disabled (held).");
  console.log("  Secrets: acme/healthy was rotated — the previous secret is in its grace window.");
  console.log("  Audit: creates, a disable/enable cycle, renames, the rotation.");
  console.log("  ~40 messages published — the dispatcher is delivering them NOW; watch");
  console.log("  attempts accumulate, the flaky endpoint retry, and dead-letters appear.");
  console.log("");
  console.log(`  → open ${BASE}`);
}

if (import.meta.main) {
  // Standalone run: boot our own receiver so the endpoints have somewhere to
  // point, then seed. The receiver dies with this process — use `bun run demo`
  // for the everything-in-one experience where it stays up.
  const receiver = await startDemoReceiver();
  try {
    await seed(DEFAULT_BASE, receiver.url);
    console.log("");
    console.log("Note: the demo receiver lives in THIS process — keep it running while you");
    console.log("browse, or use `bun run demo` which manages both for you. Ctrl-C to stop.");
    await new Promise(() => {}); // keep the receiver alive
  } catch (err) {
    console.error("Seed failed:", err instanceof Error ? err.message : err);
    console.error(`Is a server running at ${DEFAULT_BASE}? (try: bun run demo)`);
    await receiver.close();
    process.exit(1);
  }
}
