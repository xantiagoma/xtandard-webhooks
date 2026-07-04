/**
 * Hono adapter. Returns a `Hono` instance whose catch-all delegates to the
 * web-standard panel handler, so it composes via `app.route(path, panel)`.
 * The panel starts the delivery dispatcher by default; pass `dispatcher: false`
 * for split-worker deployments.
 *
 * ```ts
 * import { webhooksPanel } from "@xtandard/webhooks/hono";
 * app.route("/webhooks", webhooksPanel({ basePath: "/webhooks", storage }));
 * ```
 *
 * @module
 */

import { Hono } from "hono";
import { createFetchHandler, type WebhooksPanelOptions } from "../server/create-fetch-handler.ts";

/**
 * Create a Hono sub-app serving the panel. The admin `core`, the started
 * `dispatcher` (or `null`), and the `openapi()` document builder are attached.
 */
export function webhooksPanel(options: WebhooksPanelOptions): Hono & {
  core: ReturnType<typeof createFetchHandler>["core"];
  dispatcher: ReturnType<typeof createFetchHandler>["dispatcher"];
  openapi: ReturnType<typeof createFetchHandler>["openapi"];
} {
  const handler = createFetchHandler(options);
  const app = new Hono();
  app.all("*", (c) => handler.fetch(c.req.raw));
  return Object.assign(app, {
    core: handler.core,
    dispatcher: handler.dispatcher,
    openapi: handler.openapi,
  });
}

export type { WebhooksPanelOptions };
