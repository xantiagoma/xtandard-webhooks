/**
 * Elysia adapter. Two ways to mount:
 *
 * 1. {@link webhooksPanel} — a web-standard handler for `Elysia.mount(path, handler)`.
 *    Simplest, but opaque to Eden (the typed client can't see the routes).
 *
 *    ```ts
 *    new Elysia().mount("/webhooks", webhooksPanel({ basePath: "/webhooks", storage }));
 *    ```
 *
 * 2. {@link webhooksElysia} — a typed Elysia plugin that *declares* the admin routes,
 *    so **Eden treaty** infers them: `edenClient.webhooks.api.applications.get()`, etc.
 *    Each handler delegates to the same pipeline (auth/validation/logic reused).
 *
 *    ```ts
 *    import { treaty } from "@elysiajs/eden";
 *    const app = new Elysia().use(webhooksElysia({ prefix: "/webhooks", storage }));
 *    const client = treaty<typeof app>("localhost:3000");
 *    await client.webhooks.api.applications.get();
 *    ```
 *
 * The panel starts the delivery dispatcher by default; pass `dispatcher: false`
 * for split-worker deployments.
 *
 * @module
 */

import { Elysia, t } from "elysia";
import {
  createPass,
  webhooksPanel,
  type ElysiaWebhooksHandler,
  type WebhooksElysiaOptions,
  type WebhooksPanelOptions,
} from "./elysia-shared.ts";

export { webhooksPanel };
export type { ElysiaWebhooksHandler, WebhooksElysiaOptions, WebhooksPanelOptions };

const appParams = t.Object({ app: t.String() });
const endpointParams = t.Object({ app: t.String(), id: t.String() });
const nameParams = t.Object({ name: t.String() });

/**
 * Typed Elysia plugin exposing the admin API so the **Eden** client can call it
 * with full path/method/param typing (`edenClient.webhooks.api.applications.get()`).
 * Routes are declared for the typed surface; every handler delegates to the
 * shared fetch pipeline (auth, authorization, portal scoping, error mapping
 * reused). A catch-all also serves the bundled UI.
 *
 * Elysia 1.x only — for Elysia 2 import from `@xtandard/webhooks/elysia2`.
 */
export function webhooksElysia(options: WebhooksElysiaOptions) {
  const { prefix, pass } = createPass(options);

  const app = "/api/applications/:app";
  const endpoint = `${app}/endpoints/:id`;

  return new Elysia({ prefix, name: "xtandard-webhooks" })
    .get("/config", pass)
    .get("/api/openapi.json", pass)
    .get("/api/event-types.json", pass)
    .get("/api/applications", pass)
    .post("/api/applications", pass, {
      body: t.Object({
        key: t.String(),
        name: t.Optional(t.String()),
        metadata: t.Optional(t.Any()),
      }),
    })
    .get(app, pass, { params: appParams })
    .put(app, pass, { params: appParams, body: t.Any() })
    .delete(app, pass, { params: appParams })
    .get("/api/event-types", pass)
    .post("/api/event-types", pass, {
      body: t.Object({
        name: t.String(),
        description: t.Optional(t.String()),
        groupName: t.Optional(t.String()),
        schema: t.Optional(t.Any()),
        deprecated: t.Optional(t.Boolean()),
      }),
    })
    .get("/api/event-types/:name", pass, { params: nameParams })
    .put("/api/event-types/:name", pass, { params: nameParams, body: t.Any() })
    .delete("/api/event-types/:name", pass, { params: nameParams })
    .get(`${app}/endpoints`, pass, { params: appParams })
    .post(`${app}/endpoints`, pass, {
      params: appParams,
      body: t.Object({
        url: t.String(),
        description: t.Optional(t.String()),
        eventTypes: t.Optional(t.Array(t.String())),
        headers: t.Optional(t.Record(t.String(), t.String())),
        metadata: t.Optional(t.Any()),
        disabled: t.Optional(t.Boolean()),
      }),
    })
    .get(endpoint, pass, { params: endpointParams })
    .put(endpoint, pass, { params: endpointParams, body: t.Any() })
    .delete(endpoint, pass, { params: endpointParams })
    .get(`${endpoint}/secret`, pass, { params: endpointParams })
    .post(`${endpoint}/rotate-secret`, pass, { params: endpointParams })
    .post(`${endpoint}/enable`, pass, { params: endpointParams })
    .post(`${endpoint}/disable`, pass, { params: endpointParams })
    .post(`${endpoint}/test`, pass, {
      params: endpointParams,
      body: t.Object({ eventType: t.String(), payload: t.Optional(t.Any()) }),
    })
    .post(`${endpoint}/recover`, pass, {
      params: endpointParams,
      body: t.Object({ since: t.String() }),
    })
    .get(`${app}/messages`, pass, { params: appParams })
    .post(`${app}/messages`, pass, {
      params: appParams,
      body: t.Object({
        eventType: t.String(),
        payload: t.Any(),
        timestamp: t.Optional(t.String()),
        idempotencyKey: t.Optional(t.String()),
      }),
    })
    .get(`${app}/messages/:id`, pass, { params: endpointParams })
    .get(`${app}/deliveries`, pass, { params: appParams })
    .get(`${app}/deliveries/:id`, pass, { params: endpointParams })
    .post(`${app}/deliveries/:id/retry`, pass, { params: endpointParams })
    .get(`${app}/audit`, pass, { params: appParams })
    .all("/*", pass); // bundled UI assets + SPA fallback
}
