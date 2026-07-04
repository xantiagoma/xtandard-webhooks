/**
 * Bun adapter. The handler is already web-standard, so this is a passthrough you
 * can hand straight to `Bun.serve({ fetch })`. The panel starts the delivery
 * dispatcher by default; pass `dispatcher: false` for split-worker deployments.
 *
 * ```ts
 * import { webhooksPanel } from "@xtandard/webhooks/bun";
 * const panel = webhooksPanel({ storage });
 * Bun.serve({ port: 3000, fetch: panel.fetch });
 * ```
 *
 * @module
 */

import {
  createFetchHandler,
  type CreateFetchHandlerResult,
  type WebhooksPanelOptions,
} from "../server/create-fetch-handler.ts";

/** Create a Bun-ready panel handler (`fetch` + `core` + `dispatcher` + `openapi`). */
export function webhooksPanel(options: WebhooksPanelOptions): CreateFetchHandlerResult {
  return createFetchHandler(options);
}

export type { WebhooksPanelOptions, CreateFetchHandlerResult };
