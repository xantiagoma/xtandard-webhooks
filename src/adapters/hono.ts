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
import { mountPanel } from "@xtandard/kit/adapters/hono";
import {
  createFetchHandler,
  type CreateFetchHandlerResult,
  type WebhooksPanelOptions,
} from "../server/create-fetch-handler.ts";

/**
 * Build the panel as a Hono app (every path and method), carrying the core,
 * the dispatcher, the OpenAPI document and `close()`.
 */
export function webhooksPanel(options: WebhooksPanelOptions): Hono & {
  core: CreateFetchHandlerResult["core"];
  dispatcher: CreateFetchHandlerResult["dispatcher"];
  openapi: CreateFetchHandlerResult["openapi"];
  close: CreateFetchHandlerResult["close"];
} {
  const handler = createFetchHandler(options);
  return Object.assign(mountPanel(new Hono(), handler.fetch), {
    core: handler.core,
    dispatcher: handler.dispatcher,
    openapi: handler.openapi,
    close: handler.close,
  });
}

export type { WebhooksPanelOptions };
