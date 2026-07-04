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
};

function headersFrom(req: ExRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}

async function readBody(req: ExRequest): Promise<Uint8Array | undefined> {
  const method = (req.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") return undefined;

  // If an upstream body parser already consumed the stream, re-serialize req.body.
  if (req.readableEnded) {
    const body = (req as { body?: unknown }).body;
    if (body === undefined || body === null) return undefined;
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return new TextEncoder().encode(text);
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) chunks.push(chunk);
  return chunks.length ? new Uint8Array(Buffer.concat(chunks)) : undefined;
}

function toWebRequest(req: ExRequest, body: Uint8Array | undefined): Request {
  const protocol = req.protocol || "http";
  const host = req.get?.("host") ?? req.headers.host ?? "localhost";
  // originalUrl preserves the mount prefix (e.g. /webhooks/api/...) and query string.
  const url = `${protocol}://${host}${req.originalUrl ?? req.url ?? "/"}`;
  return new Request(url, {
    method: req.method,
    headers: headersFrom(req),
    // Uint8Array is a valid BodyInit; the cast satisfies TS 5.7's generic typing.
    body: body as BodyInit | undefined,
  });
}

async function writeWebResponse(res: ExResponse, response: Response): Promise<void> {
  res.status(response.status);
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}

/** Create an Express handler serving the panel. Use with `app.use(path, handler)`. */
export function webhooksPanel(options: WebhooksPanelOptions): ExpressWebhooksHandler {
  const handler = createFetchHandler(options);

  const middleware = (req: ExRequest, res: ExResponse, next: NextFunction): void => {
    (async () => {
      const body = await readBody(req);
      const request = toWebRequest(req, body);
      const response = await handler.fetch(request);
      await writeWebResponse(res, response);
    })().catch(next);
  };

  return Object.assign(middleware, {
    core: handler.core,
    dispatcher: handler.dispatcher,
    openapi: handler.openapi,
  });
}

export type { WebhooksPanelOptions };
