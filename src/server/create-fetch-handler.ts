/**
 * The web-standard fetch handler at the heart of every framework adapter and the
 * standalone app. Composes auth/authorization (plus portal-token scoping), the
 * JSON admin API, static-asset serving, and SPA fallback into a single
 * `(request: Request) => Promise<Response>` — and, by default, starts the
 * in-process delivery dispatcher so mounting the panel is all it takes to
 * deliver webhooks.
 *
 * @module
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AuthProvider } from "../auth/contract.ts";
import type { AuthorizationProvider } from "../authorization/contract.ts";
import { createWebhooksCore, type RetentionOptions, type WebhooksCore } from "../core.ts";
import type { DeliveryErrorReporter, DeliveryListener } from "../delivery-sink.ts";
import { createDispatcher, type Dispatcher, type DispatcherOptions } from "../dispatcher.ts";
import type { HookErrorReporter, WebhooksHooksInput } from "../hooks/contract.ts";
import type { WebhooksStorage } from "../storage/contract.ts";
import { normalizeBasePath, stripBasePath } from "./base-path.ts";
import { applyCorsHeaders, preflightResponse, type WebhooksCorsOptions } from "./cors.ts";
import { buildOpenApiDocument } from "./openapi.ts";
import { renderIndexHtml } from "./render-index-html.ts";
import { handleApiRequest, type ApiContext, type WebhooksPortalOptions } from "./routes.ts";
import { looksLikeAsset, serveStaticAsset } from "./static-assets.ts";

/** Options for the panel handler (shared by every framework adapter). */
export interface WebhooksPanelOptions {
  /** Control-plane store: applications, event types, endpoints, messages, audit. */
  storage: WebhooksStorage;
  /** Store for deliveries, attempts, and the due index. Defaults to `storage`. */
  queueStorage?: WebhooksStorage;
  /** Mount prefix, e.g. `"/webhooks"`. Default `""` (root). */
  basePath?: string;
  /** Authentication provider. Default: anonymous (no auth). */
  auth?: AuthProvider;
  /** Authorization provider. Default: allow all. */
  authorization?: AuthorizationProvider;
  /**
   * Portal-token composition: requests bearing a valid `whpt_…` token act as a
   * portal principal scoped to the token's application. Mint tokens
   * server-side with `createPortalToken`. See
   * {@link ./routes.WebhooksPortalOptions}.
   */
  portal?: WebhooksPortalOptions;
  /** Block all mutating operations when true. */
  readonly?: boolean;
  /** UI title shown in the page and bootstrap config. */
  title?: string;
  /** Logo image URL shown in the navbar in place of the title wordmark. */
  logoUrl?: string;
  /** Override the directory the bundled UI is served from (defaults to `./ui` beside this module). */
  uiDir?: string;
  /** Reuse an existing core instead of constructing one. */
  core?: WebhooksCore;
  /**
   * Control-plane hooks fired around admin mutations (see
   * {@link ../hooks/contract.WebhooksHooks}). Ignored when `core` is supplied —
   * configure hooks on that core instead.
   */
  hooks?: WebhooksHooksInput;
  /** Reporter for errors thrown by `after` hooks. Default: `console.warn`. */
  onHookError?: HookErrorReporter;
  /**
   * Message/audit retention policy. Ignored when a prebuilt `core` is supplied —
   * configure it on that core instead. See {@link ../core.RetentionOptions}.
   */
  retention?: RetentionOptions;
  /**
   * Fire-and-forget sink invoked for **every** delivery attempt (metrics tap).
   * Ignored when `core` is supplied. See {@link ../delivery-sink.DeliveryListener}.
   */
  onDelivery?: DeliveryListener;
  /** Reporter for errors thrown by `onDelivery`. Default: `console.warn`. */
  onDeliveryError?: DeliveryErrorReporter;
  /**
   * Enable CORS on the handler itself — answers `OPTIONS` preflights and attaches
   * `Access-Control-*` headers to every response, so a **cross-origin** embed
   * works regardless of the host framework. See {@link ./cors.WebhooksCorsOptions}.
   */
  cors?: WebhooksCorsOptions;
  /**
   * Delivery-engine configuration. By default the panel creates **and starts**
   * a dispatcher so deliveries flow the moment the panel is mounted. Pass
   * `false` to skip it entirely (split-worker deployments where a separate
   * process runs `xtandard-webhooks dispatch` against the same storage).
   */
  dispatcher?: DispatcherOptions | false;
}

/** Return shape of {@link createFetchHandler}. */
export interface CreateFetchHandlerResult {
  /** Web-standard request handler. */
  fetch(request: Request): Promise<Response>;
  /** The underlying core (handy for `publish()`, tests, CLI, and standalone wiring). */
  core: WebhooksCore;
  /** The started dispatcher, or `null` when `dispatcher: false`. */
  dispatcher: Dispatcher | null;
  /**
   * The admin API as an OpenAPI 3.1 document (also served at `{basePath}/api/openapi.json`).
   * Merge it into your host app's docs — e.g. Elysia `@elysiajs/openapi` `references`.
   */
  openapi(): Record<string, unknown>;
}

// Anonymous defaults keep embedded usage zero-config; harden via auth/authorization.
const defaultAuth: AuthProvider = { authenticate: async () => ({ id: "anonymous" }) };
const defaultAuthorization: AuthorizationProvider = { authorize: async () => true };

/**
 * Locate the built admin SPA (`dist/ui`). When this module runs compiled (the
 * normal npm-consumer case) it lives in `dist/` and the bundle is the sibling
 * `./ui`. When it runs from TypeScript source (examples / dev against a
 * `file:`-linked checkout, where the runtime executes `src/server/*.ts`
 * directly), the bundle is instead at `<repo>/dist/ui` — i.e. `../../dist/ui`
 * relative to `src/server/`. Try the candidates and return the first that
 * exists, falling back to the compiled-layout path so the "build the UI" hint
 * still fires when nothing is built yet.
 */
function defaultUiDir(): string {
  try {
    const candidates = [
      new URL("./ui", import.meta.url), // compiled: dist/<chunk>.mjs → dist/ui
      new URL("../../dist/ui", import.meta.url), // source: src/server/*.ts → <repo>/dist/ui
    ].map((u) => fileURLToPath(u));
    return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
  } catch {
    return "./ui";
  }
}

/**
 * Build the panel fetch handler.
 *
 * @example
 * ```ts
 * import { createFetchHandler } from "@xtandard/webhooks";
 * import { createFileStorage } from "@xtandard/webhooks/storage/file";
 *
 * const storage = createFileStorage({ dir: "./data/webhooks" });
 * const { fetch, core } = createFetchHandler({
 *   storage,
 *   basePath: "/webhooks",
 *   title: "Acme Webhooks",
 * });
 *
 * Bun.serve({ port: 3000, fetch });
 * // Elsewhere in the app:
 * await core.publish("acme", { eventType: "invoice.paid", payload: { id: "inv_1" } });
 * ```
 */
export function createFetchHandler(options: WebhooksPanelOptions): CreateFetchHandlerResult {
  const basePath = normalizeBasePath(options.basePath);
  const readonly = options.readonly ?? false;
  const title = options.title ?? "@xtandard/webhooks";
  const uiDir = options.uiDir ?? defaultUiDir();
  const dispatcherOptions = options.dispatcher === false ? undefined : options.dispatcher;

  const core =
    options.core ??
    createWebhooksCore({
      storage: options.storage,
      ...(options.queueStorage ? { queueStorage: options.queueStorage } : {}),
      readonly,
      ...(options.hooks !== undefined ? { hooks: options.hooks } : {}),
      ...(options.onHookError ? { onHookError: options.onHookError } : {}),
      ...(options.retention ? { retention: options.retention } : {}),
      ...(options.onDelivery ? { onDelivery: options.onDelivery } : {}),
      ...(options.onDeliveryError ? { onDeliveryError: options.onDeliveryError } : {}),
      ...(dispatcherOptions ? { dispatcher: dispatcherOptions } : {}),
    });

  // The panel owns the default embedded deployment shape: dispatcher created
  // AND started (timers are unref()ed — it never keeps the process alive).
  let dispatcher: Dispatcher | null = null;
  if (options.dispatcher !== false) {
    dispatcher = createDispatcher(core, dispatcherOptions ?? {});
    dispatcher.start();
  }

  const apiCtx: ApiContext = {
    core,
    auth: options.auth ?? defaultAuth,
    authorization: options.authorization ?? defaultAuthorization,
    title,
    readonly,
    basePath,
    ...(options.logoUrl !== undefined ? { logoUrl: options.logoUrl } : {}),
    ...(options.portal ? { portal: options.portal } : {}),
  };

  const cors = options.cors;

  async function fetch(request: Request): Promise<Response> {
    // CORS preflight: answer OPTIONS directly so it works for any path,
    // independent of the host framework wrapping this handler.
    if (cors && request.method === "OPTIONS") return preflightResponse(request, cors);
    const response = await respond(request);
    return cors ? applyCorsHeaders(request, response, cors) : response;
  }

  async function respond(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = stripBasePath(url.pathname, basePath);

    // 1. JSON API + bootstrap config.
    const api = await handleApiRequest(request, path, apiCtx);
    if (api) return api;

    // 2. Only GET/HEAD reach the static UI.
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // 3. Static asset.
    const asset = await serveStaticAsset(uiDir, path);
    if (asset) return asset;

    // 4. A path that looks like a file but was not found → 404 (don't mask with the SPA).
    if (path !== "/" && looksLikeAsset(path)) {
      return new Response("Not Found", { status: 404 });
    }

    // 5. SPA fallback.
    const html = await renderIndexHtml(uiDir, {
      title,
      basePath,
      readonly,
      ...(options.logoUrl !== undefined ? { logoUrl: options.logoUrl } : {}),
    });
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  return { fetch, core, dispatcher, openapi: () => buildOpenApiDocument({ basePath, title }) };
}
