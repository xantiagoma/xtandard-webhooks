# Hono × @xtandard/webhooks

Mount the admin panel **and** publish a webhook from an app route on a user
action — so you can _see_ a publish become a signed, delivered (and retried)
webhook.

## What's here

- **`GET /`** — a signup page. Each signup `POST`s to `/signup`.
- **`POST /signup`** — calls `panel.core.publish("acme", { eventType: "user.created", … })`.
  That is the entire integration surface for your app: one call, never blocked
  by a customer's server being down.
- **`GET /webhooks`** — the embedded admin panel (applications, endpoints,
  messages, deliveries, dead-letters).

The adapter returns a `Hono` sub-app, composed with `app.route()`. It starts
the delivery dispatcher in-process, so published messages are delivered moments
later. On first boot the app idempotently seeds the `acme` application and the
`user.created` event type.

## Run it

```bash
bun install                 # links @xtandard/webhooks
bun run start               # honors PORT; defaults to 3000
```

Then open <http://localhost:3000>.

## The loop

1. Open <http://localhost:3000/webhooks> → application **acme** → add an
   endpoint (any URL you control — a local receiver, or a hosted webhook
   viewer).
2. Open <http://localhost:3000> and click **Sign up**.
3. Back in the panel: a `user.created` message appears with one delivery per
   subscribed endpoint, each attempt signed per Standard Webhooks. If the
   endpoint is down, watch the retry schedule take over.

## Files

- [`src/index.ts`](./src/index.ts) — wires the panel, the seed, and the signup route.
- [`src/demo.ts`](./src/demo.ts) — the idempotent boot seed and the HTML page.
