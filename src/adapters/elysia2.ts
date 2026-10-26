/**
 * Elysia **2.x** adapter — same surface as `@xtandard/webhooks/elysia`, built
 * against Elysia 2's types and its `(path, hook, handler)` route order. Use
 * `@xtandard/webhooks/elysia` for Elysia 1.x.
 *
 * ```ts
 * new Elysia().mount("/webhooks", webhooksPanel({ basePath: "/webhooks", storage }));
 * // or, typed for Eden treaty (`@elysia/eden`):
 * const app = new Elysia().use(webhooksElysia({ prefix: "/webhooks", storage }));
 * ```
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
 * Elysia 2.x only — for Elysia 1.x import from `@xtandard/webhooks/elysia`.
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
    .post(
      "/api/applications",
      {
        body: t.Object({
          key: t.String(),
          name: t.Optional(t.String()),
          metadata: t.Optional(t.Any()),
        }),
      },
      pass,
    )
    .get(app, { params: appParams }, pass)
    .put(app, { params: appParams, body: t.Any() }, pass)
    .delete(app, { params: appParams }, pass)
    .get("/api/event-types", pass)
    .post(
      "/api/event-types",
      {
        body: t.Object({
          name: t.String(),
          description: t.Optional(t.String()),
          groupName: t.Optional(t.String()),
          schema: t.Optional(t.Any()),
          deprecated: t.Optional(t.Boolean()),
        }),
      },
      pass,
    )
    .get("/api/event-types/:name", { params: nameParams }, pass)
    .put("/api/event-types/:name", { params: nameParams, body: t.Any() }, pass)
    .delete("/api/event-types/:name", { params: nameParams }, pass)
    .get(`${app}/endpoints`, { params: appParams }, pass)
    .post(
      `${app}/endpoints`,
      {
        params: appParams,
        body: t.Object({
          url: t.String(),
          description: t.Optional(t.String()),
          eventTypes: t.Optional(t.Array(t.String())),
          headers: t.Optional(t.Record(t.String(), t.String())),
          metadata: t.Optional(t.Any()),
          disabled: t.Optional(t.Boolean()),
        }),
      },
      pass,
    )
    .get(endpoint, { params: endpointParams }, pass)
    .put(endpoint, { params: endpointParams, body: t.Any() }, pass)
    .delete(endpoint, { params: endpointParams }, pass)
    .get(`${endpoint}/secret`, { params: endpointParams }, pass)
    .post(`${endpoint}/rotate-secret`, { params: endpointParams }, pass)
    .post(`${endpoint}/enable`, { params: endpointParams }, pass)
    .post(`${endpoint}/disable`, { params: endpointParams }, pass)
    .post(
      `${endpoint}/test`,
      {
        params: endpointParams,
        body: t.Object({ eventType: t.String(), payload: t.Optional(t.Any()) }),
      },
      pass,
    )
    .post(
      `${endpoint}/recover`,
      {
        params: endpointParams,
        body: t.Object({ since: t.String() }),
      },
      pass,
    )
    .get(`${app}/messages`, { params: appParams }, pass)
    .post(
      `${app}/messages`,
      {
        params: appParams,
        body: t.Object({
          eventType: t.String(),
          payload: t.Any(),
          timestamp: t.Optional(t.String()),
          idempotencyKey: t.Optional(t.String()),
        }),
      },
      pass,
    )
    .get(`${app}/messages/:id`, { params: endpointParams }, pass)
    .get(`${app}/deliveries`, { params: appParams }, pass)
    .get(`${app}/deliveries/:id`, { params: endpointParams }, pass)
    .post(`${app}/deliveries/:id/retry`, { params: endpointParams }, pass)
    .get(`${app}/audit`, { params: appParams }, pass)
    .all("/*", pass); // bundled UI assets + SPA fallback
}
