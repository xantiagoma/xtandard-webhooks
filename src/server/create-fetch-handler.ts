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

import {
  createPanelHandler,
  requireOneOf,
  resolveUiDir,
  type CorsOptions,
} from "@xtandard/kit/server";
import type { AuthProvider } from "../auth/contract.ts";
import type { AuthorizationProvider } from "../authorization/contract.ts";
import { createWebhooksCore, type RetentionOptions, type WebhooksCore } from "../core.ts";
import type { DeliveryErrorReporter, DeliveryListener } from "../delivery-sink.ts";
import { createDispatcher, type Dispatcher, type DispatcherOptions } from "../dispatcher.ts";
import type { HookErrorReporter, WebhooksHooksInput } from "../hooks/contract.ts";
import { hasDeliveryQueue, isCompareAndSwap, type WebhooksStorage } from "../storage/contract.ts";
import { buildOpenApiDocument } from "./openapi.ts";
import { handleApiRequest, type ApiContext, type WebhooksPortalOptions } from "./routes.ts";

/**
 * CORS for the panel: `origin` (a string, a list, or a predicate; `"*"` with
 * `credentials` echoes the caller's origin), `credentials`, `methods`,
 * `headers` and `maxAge`.
 */
export type WebhooksCorsOptions = CorsOptions;

/** Options for the panel handler (shared by every framework adapter). */
export interface WebhooksPanelOptions {
  /**
   * Control-plane store: applications, event types, endpoints, messages, audit.
   * Required unless a prebuilt `core` is supplied (which carries its own
   * storage, and its `queueStorage`, as the source of truth).
   */
  storage?: WebhooksStorage;
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
   * works regardless of the host framework. See {@link WebhooksCorsOptions}.
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
  /** Stop the dispatcher this panel started (idempotent; a no-op with `dispatcher: false`). */
  close(): Promise<void>;
}

// Anonymous defaults keep embedded usage zero-config; harden via auth/authorization.
const defaultAuth: AuthProvider = { authenticate: async () => ({ id: "anonymous" }) };
const defaultAuthorization: AuthorizationProvider = { authorize: async () => true };

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
  const readonly = options.readonly ?? false;
  const title = options.title ?? "@xtandard/webhooks";
  const dispatcherOptions = options.dispatcher === false ? undefined : options.dispatcher;

  // Either a prebuilt `core` (its own source of truth for storage) or a
  // `storage` to build one from is required.
  requireOneOf("createFetchHandler", options, ["storage", "core"]);

  const core =
    options.core ??
    createWebhooksCore({
      storage: options.storage!,
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
    // Claiming is only exclusive across processes when the queue storage has
    // native claimDue (redis/memory) or compare-and-swap. On plainer backends
    // (unstorage/cloudflare-kv) two dispatchers can claim the same delivery and
    // double-send. Since the panel auto-starts one on EVERY mount, warn loudly
    // so a horizontally-scaled deployment sets `dispatcher: false` on all but
    // one instance (or runs a single split worker). See docs/DELIVERY.md.
    //
    // Check the CORE's queue storage — that is what the dispatcher actually
    // claims over (`core.claimDueDeliveries`). It is the source of truth
    // whether the core was built here or supplied prebuilt with its own
    // split `queueStorage`.
    const queue = core.options.queueStorage;
    if (!hasDeliveryQueue(queue) && !isCompareAndSwap(queue)) {
      // eslint-disable-next-line no-console
      console.warn(
        "[@xtandard/webhooks] The panel started an in-process dispatcher over storage " +
          "without atomic claiming (no claimDue/compareAndSwap). If you run more than one " +
          "instance, deliveries WILL be sent multiple times — set `dispatcher: false` on all " +
          "but one instance, or use redis/memory storage. See docs/DELIVERY.md.",
      );
    }
    dispatcher = createDispatcher(core, dispatcherOptions ?? {});
  }
  const running = dispatcher;

  let apiCtx: ApiContext | undefined;
  const panel = createPanelHandler({
    basePath: options.basePath,
    title,
    readonly,
    globalName: "__WEBHOOKS_CONFIG__",
    uiDir: options.uiDir ?? resolveUiDir(import.meta.url),
    ...(options.logoUrl !== undefined ? { logoUrl: options.logoUrl } : {}),
    ...(options.cors ? { cors: options.cors } : {}),
    api: (request, path) => handleApiRequest(request, path, apiCtx!),
    tasks: running ? [{ start: () => running.start(), stop: () => running.stop() }] : [],
  });
  const { basePath } = panel;

  apiCtx = {
    core,
    auth: options.auth ?? defaultAuth,
    authorization: options.authorization ?? defaultAuthorization,
    title,
    readonly,
    basePath,
    ...(options.logoUrl !== undefined ? { logoUrl: options.logoUrl } : {}),
    ...(options.portal ? { portal: options.portal } : {}),
  };

  return {
    fetch: panel.fetch,
    core,
    dispatcher,
    openapi: () => buildOpenApiDocument({ basePath, title }),
    close: panel.close,
  };
}
