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
new Elysia().mount("/webhooks", webhooks).listen(3000);
```

For end-to-end typed clients (Eden), use the typed plugin instead — it declares every admin route with schemas:

```ts
import { webhooksElysia } from "@xtandard/webhooks/elysia";

const app = new Elysia().use(webhooksElysia({ prefix: "/webhooks", storage })).listen(3000);
export type App = typeof app; // → treaty<App> infers the whole webhooks API
```

### Elysia 2 — `@xtandard/webhooks/elysia2`

Elysia 2 (currently `elysia@rc`) changed two things that matter to the typed plugin: routes take `(path, hook, handler)` instead of `(path, handler, hook)`, and the `Elysia` class generics changed — so a plugin's `.d.ts` built against one major doesn't type-check (or feed Eden) on the other. `@xtandard/webhooks/elysia2` is the same surface — `webhooksPanel` and `webhooksElysia` — built and typed against Elysia 2:

```ts
import { Elysia } from "elysia"; // 2.x
import { webhooksElysia } from "@xtandard/webhooks/elysia2";

const app = new Elysia().use(webhooksElysia({ prefix: "/webhooks", storage })).listen(3000);
export type App = typeof app;
```

```ts
import { treaty } from "@elysia/eden"; // Elysia 2's Eden (was @elysiajs/eden)
const client = treaty<App>("localhost:3000");
await client.webhooks!.api.applications.get();
```

| Elysia | Import from                  | Eden client      |
| ------ | ---------------------------- | ---------------- |
| 1.x    | `@xtandard/webhooks/elysia`  | `@elysiajs/eden` |
| 2.x    | `@xtandard/webhooks/elysia2` | `@elysia/eden`   |

`webhooksPanel` (the `.mount()` handler) is version-agnostic and works from either import; only the typed `webhooksElysia` plugin is tied to a major.

### Request context with `.wrap()`

`.wrap()` wraps the whole fetch pipeline (mounted handlers included), so an `AsyncLocalStorage` store set there is visible to your `before` hooks and delegated auth/authorization providers — no adapter needed:

```ts
import { AsyncLocalStorage } from "node:async_hooks";

const requestContext = new AsyncLocalStorage<{ userId?: string }>();

new Elysia()
  .wrap(
    (fetch) => (request) =>
      requestContext.run({ userId: userIdFrom(request) }, () => fetch(request)),
  )
  .mount("/webhooks", webhooksPanel({ storage, hooks: [auditHook(requestContext)] }));
```

The dispatcher runs on its own ticks, outside any request: `delivery.*` `after` hooks and the `onDelivery` sink always see an empty store. Anything they need from the originating request (a trace id, the acting user) belongs in the message itself at `publish()` time.

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
