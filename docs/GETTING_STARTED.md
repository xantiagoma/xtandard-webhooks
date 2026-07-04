# Getting Started

Zero to a signed, retried, observable webhook in about five minutes.

## 1. Install and mount

```sh
bun add @xtandard/webhooks
```

```ts
// Elysia (Hono/Express/Bun below and in docs/ADAPTERS.md)
import { Elysia } from "elysia";
import { webhooksPanel } from "@xtandard/webhooks/elysia";
import { createMemoryStorage } from "@xtandard/webhooks/storage/memory";

const webhooks = webhooksPanel({ storage: createMemoryStorage() });

new Elysia().mount("/webhooks", webhooks.fetch).listen(3000);
```

Open http://localhost:3000/webhooks — the admin UI is live, and an in-process dispatcher is already running. Memory storage is for the first five minutes; swap in your real DB with one line (`docs/STORAGE.md`).

## 2. Create the plumbing

In the UI (or via the API/CLI): create an **application** (`acme` — the unit of tenancy, usually one of your customers), an **event type** (`invoice.paid`), and an **endpoint** (the customer's URL, subscribed to `invoice.paid`). The endpoint's `whsec_` secret is shown **once** at creation — that is what the receiver verifies with.

Programmatically:

```ts
const { core } = webhooks;
await core.createApplication({ key: "acme" });
await core.upsertEventType({ name: "invoice.paid" });
const endpoint = await core.createEndpoint("acme", {
  url: "https://api.acme-customer.com/webhooks",
  eventTypes: ["invoice.paid"],
});
```

## 3. Publish from your app code

```ts
// In the request handler where the invoice actually gets paid:
await core.publish("acme", {
  eventType: "invoice.paid",
  payload: { invoiceId: "inv_123", amount: 4200 },
  idempotencyKey: `invoice-paid-${invoice.id}`, // safe to call twice
});
```

That's the whole hot path — one storage write plus fan-out, no HTTP, never blocked by a down receiver. The dispatcher signs and delivers asynchronously, retries on failure (`0s, 5s, 5m, 30m, 2h, 5h, 10h` by default), and dead-letters into the UI when the schedule exhausts.

## 4. Verify on the receiving side

```ts
import { verifyWebhook } from "@xtandard/webhooks/receiver";

// The customer's server:
export default async function handler(request: Request) {
  const event = await verifyWebhook(request, process.env.WEBHOOK_SECRET!); // throws if invalid
  if (event.type === "invoice.paid") await markPaid(event.data);
  return new Response("ok");
}
```

Receivers in other languages use the official Standard Webhooks libraries unmodified — see `docs/SIGNING.md` and `examples/receivers/`.

## 5. Watch it work

The **Deliveries** view shows every attempt with HTTP detail; **Send example** on an endpoint fires a signed test event; a failing endpoint walks the retry schedule into the Dead-letter tab, where **Retry** re-queues it.

## Where to next

| Goal                                         | Doc                                     |
| -------------------------------------------- | --------------------------------------- |
| Real database / split Postgres+Redis planes  | `docs/STORAGE.md`                       |
| Retries, dead-letters, replay, at-least-once | `docs/DELIVERY.md`                      |
| Lock down the panel                          | `docs/AUTH.md`, `docs/AUTHORIZATION.md` |
| Customer-facing portal                       | `docs/PORTAL.md`, `docs/UI.md`          |
| Quotas, notifications, offloading            | `docs/HOOKS.md`                         |
| Docker / split worker / env vars             | `docs/DEPLOYMENT.md`                    |
| Test your integration                        | `docs/TESTING.md`                       |
| Seeded playground                            | `bun run demo` → http://localhost:7789  |
