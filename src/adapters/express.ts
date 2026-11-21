/**
 * Express adapter. Express predates the web Fetch API, so this bridges Node's
 * `req`/`res` to the web-standard handler: it builds a `Request` from the
 * incoming message, runs {@link createFetchHandler}, and writes the `Response`
 * back. No `express` import at runtime — only its types.
 *
 * Mount it BEFORE any body-parser middleware (it reads the raw request body):
 *
 * ```ts
 * import express from "express";
 * import { webhooksPanel } from "@xtandard/webhooks/express";
 * const app = express();
 * app.use("/webhooks", webhooksPanel({ basePath: "/webhooks", storage }));
 * ```
 *
 * The panel starts the delivery dispatcher by default; pass `dispatcher: false`
 * for split-worker deployments.
 *
 * @module
 */

import type { NextFunction, Request as ExRequest, Response as ExResponse } from "express";
import { toExpressMiddleware } from "@xtandard/kit/adapters/express";
import { createFetchHandler, type WebhooksPanelOptions } from "../server/create-fetch-handler.ts";

/** An Express request handler with the admin `core` + `dispatcher` + `openapi` attached. */
export type ExpressWebhooksHandler = ((
  req: ExRequest,
  res: ExResponse,
  next: NextFunction,
) => void) & {
  core: ReturnType<typeof createFetchHandler>["core"];
  dispatcher: ReturnType<typeof createFetchHandler>["dispatcher"];
  openapi: ReturnType<typeof createFetchHandler>["openapi"];
  close: ReturnType<typeof createFetchHandler>["close"];
};

/** Create an Express handler serving the panel. Use with `app.use(path, handler)`. */
export function webhooksPanel(options: WebhooksPanelOptions): ExpressWebhooksHandler {
  const handler = createFetchHandler(options);

  // The kit's Node bridge: every Set-Cookie kept, multi-value headers appended,
  // pre-parsed bodies re-serialised, responses streamed with backpressure.
  const middleware = toExpressMiddleware(handler.fetch);

  return Object.assign(middleware, {
    core: handler.core,
    dispatcher: handler.dispatcher,
    openapi: handler.openapi,
    close: handler.close,
  });
}

export type { WebhooksPanelOptions };
