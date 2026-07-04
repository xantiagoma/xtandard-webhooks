# Adapters

One panel, four mounts. Every adapter wraps `createFetchHandler` and exposes the same extras: `.core` (the operations surface — call `core.publish()` from your routes), `.dispatcher` (started by default; `dispatcher: false` for split workers), `.openapi()` (merge into your own docs).

All adapters take the same `WebhooksPanelOptions` (`storage`, `queueStorage`, `basePath`, `auth`, `authorization`, `portal`, `readonly`, `title`, `logoUrl`, `hooks`, `retention`, `onDelivery`, `cors`, `dispatcher`, …).

## Bun

```ts
import { webhooksPanel } from "@xtandard/webhooks/bun";

const webhooks = webhooksPanel({ storage, basePath: "/webhooks" });
Bun.serve({ port: 3000, fetch: webhooks.fetch });
```

## Elysia

```ts
import { Elysia } from "elysia";
import { webhooksPanel } from "@xtandard/webhooks/elysia";

const webhooks = webhooksPanel({ storage });
new Elysia().mount("/webhooks", webhooks.fetch).listen(3000);
```

For end-to-end typed clients (Eden), use the typed plugin instead — it declares every admin route with schemas:

```ts
import { webhooksElysia } from "@xtandard/webhooks/elysia";

const app = new Elysia().use(webhooksElysia({ prefix: "/webhooks", storage })).listen(3000);
export type App = typeof app; // → treaty<App> infers the whole webhooks API
```

## Hono

```ts
import { Hono } from "hono";
import { webhooksPanel } from "@xtandard/webhooks/hono";

const app = new Hono();
app.route("/webhooks", webhooksPanel({ storage }));
```

## Express

```ts
import express from "express";
import { webhooksPanel } from "@xtandard/webhooks/express";

const app = express();
app.use("/webhooks", webhooksPanel({ storage })); // BEFORE express.json()/body-parser
app.use(express.json());
```

The Express adapter bridges Node req/res to fetch semantics and buffers request bodies. Mount it before any body parser; if one already consumed the stream, the adapter re-serializes `req.body`, but mounting first is the reliable order.

## Sharing one core

Mount the panel and publish from the same process by reusing the adapter's `core` — don't create a second core over the same storage in the same process (it works, but you'd configure hooks/sinks twice):

```ts
const webhooks = webhooksPanel({ storage });
app.post("/signup", async (req) => {
  await createUser(req);
  await webhooks.core.publish("acme", { eventType: "user.created", payload: { … } });
});
```
