/**
 * Elysia-version-agnostic pieces shared by the 1.x (`./elysia.ts`) and 2.x
 * (`./elysia2.ts`) adapters. Must not import `elysia`: each adapter's types are
 * built against a different major.
 *
 * @module
 */

import type { WebhooksCore } from "../core.ts";
import type { Dispatcher } from "../dispatcher.ts";
import { createFetchHandler, type WebhooksPanelOptions } from "../server/create-fetch-handler.ts";

/** A web-standard fetch handler with `core` + `dispatcher` + `openapi()` attached. */
export interface ElysiaWebhooksHandler {
  /** Handle a request (what `Elysia.mount(path, handler)` calls). */
  (request: Request): Promise<Response>;
  /** The underlying core (handy for `publish()`, tests, CLI, and standalone wiring). */
  core: WebhooksCore;
  /** The started dispatcher, or `null` when `dispatcher: false`. */
  dispatcher: Dispatcher | null;
  /** The admin API as an OpenAPI 3.1 document (also served at `{basePath}/api/openapi.json`). */
  openapi(): Record<string, unknown>;
}

/** Create a panel handler suitable for `Elysia.mount(path, handler)`. */
export function webhooksPanel(options: WebhooksPanelOptions): ElysiaWebhooksHandler {
  const handler = createFetchHandler(options);
  const fn = ((request: Request) => handler.fetch(request)) as ElysiaWebhooksHandler;
  fn.core = handler.core;
  fn.dispatcher = handler.dispatcher;
  fn.openapi = handler.openapi;
  return fn;
}

/** Options for `webhooksElysia`. */
export interface WebhooksElysiaOptions extends WebhooksPanelOptions {
  /** Mount prefix; also used as the panel basePath. Default `"/webhooks"`. */
  prefix?: string;
}

/**
 * Build the handler every declared route delegates to. Elysia parses the body
 * for declared routes, draining the stream; rebuild the Request from the parsed
 * body before delegating (mirrors the Express adapter).
 */
export function createPass(options: WebhooksElysiaOptions): {
  prefix: string;
  pass: (ctx: { request: Request; body?: unknown }) => Promise<Response>;
} {
  const prefix = options.prefix ?? "/webhooks";
  const handler = createFetchHandler({ ...options, basePath: options.basePath ?? prefix });

  const pass = (ctx: { request: Request; body?: unknown }): Promise<Response> => {
    const r = ctx.request;
    if (ctx.body != null && (r.method === "POST" || r.method === "PUT")) {
      return handler.fetch(
        new Request(r.url, {
          method: r.method,
          headers: r.headers,
          body: JSON.stringify(ctx.body),
        }),
      );
    }
    return handler.fetch(r);
  };

  return { prefix, pass };
}

export type { WebhooksPanelOptions };
