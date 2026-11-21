/**
 * JSON admin API. A tiny method+pattern router over {@link WebhooksCore}, wired
 * to authentication, authorization, and portal-token scoping. Returns `null`
 * for non-API paths so the caller can fall through to static-asset / SPA
 * handling.
 *
 * The consumer **portal** is not a separate route set — a request bearing a
 * valid `Authorization: Bearer whpt_…` token hits this same API with its
 * authorization force-scoped to the token's application and allowed actions
 * (the host's own auth/authorization providers are bypassed for portal
 * principals; portal scoping wins).
 *
 * @module
 */

import type { AuthProvider, Principal } from "../auth/contract.ts";
import type {
  AuthorizationProvider,
  WebhooksAction,
  WebhooksResource,
} from "../authorization/contract.ts";
import type { WebhooksCore } from "../core.ts";
import {
  authenticate,
  authorize as authorizeRequest,
  error,
  HttpError,
  intParam,
  json,
  mapError as kitMapError,
  match as kitMatch,
  type Authenticated,
  type ErrorMap,
} from "@xtandard/kit/server";
import { PORTAL_TOKEN_PREFIX, verifyPortalToken } from "../portal.ts";
import type { Actor, DeliveryStatus, Endpoint, EventType, JsonValue } from "../schema.ts";
import { KEY_REGEX } from "../validation.ts";
import { buildOpenApiDocument } from "./openapi.ts";

/**
 * Portal composition for the panel: when set, requests bearing a valid
 * `whpt_…` token act as a portal principal scoped to the token's application.
 */
export interface WebhooksPortalOptions {
  /** The HMAC secret portal tokens are minted with (`createPortalToken`). */
  secret: string;
  /**
   * Actions a portal principal may perform (always confined to the token's
   * application). Defaults to {@link DEFAULT_PORTAL_ACTIONS}.
   */
  allow?: WebhooksAction[];
}

/**
 * The default portal grant: manage own endpoints (including secrets), inspect
 * own messages/deliveries, retry, and read the event-type catalog.
 */
export const DEFAULT_PORTAL_ACTIONS: readonly WebhooksAction[] = [
  "endpoint:read",
  "endpoint:create",
  "endpoint:update",
  "endpoint:delete",
  "endpoint:rotate-secret",
  "endpoint:read-secret",
  "message:read",
  "delivery:read",
  "delivery:retry",
  "event-type:read",
];

/** Everything the API router needs. */
export interface ApiContext {
  core: WebhooksCore;
  auth: AuthProvider;
  authorization: AuthorizationProvider;
  title: string;
  readonly: boolean;
  basePath: string;
  logoUrl?: string;
  /** Portal-token composition (see {@link WebhooksPortalOptions}). */
  portal?: WebhooksPortalOptions;
}

/**
 * Match `pattern` (with `:name` segments) against `path` (the kit's `match`: a
 * malformed `%` escape is no match). Every parameter names a stored key
 * segment — an application key, event type name or generated id — so one that
 * could never have been created (`KEY_REGEX`) is a 404 before it reaches
 * storage: on MySQL's PAD SPACE collation `"acme "` would otherwise read and
 * write `"acme"`.
 */
function match(pattern: string, path: string): { params: Record<string, string> } | null {
  const params = kitMatch(pattern, path);
  if (!params) return null;
  if (!Object.values(params).every((value) => KEY_REGEX.test(value) && !/^\.+$/.test(value))) {
    throw new HttpError(404, "Not found");
  }
  return { params };
}

/**
 * An endpoint as served by read routes: secrets stripped. The secret is
 * returned exactly once at mint time (create / rotate); afterwards it is only
 * reachable through the dedicated `/secret` route gated by
 * `endpoint:read-secret`.
 */
function withoutSecrets(endpoint: Endpoint): Omit<Endpoint, "secrets"> {
  const { secrets: _secrets, ...rest } = endpoint;
  return rest;
}

/** The per-request scope a valid portal token establishes. */
interface PortalScope {
  applicationKey: string;
  allow: ReadonlySet<WebhooksAction>;
}

/** Build the audit {@link Actor} for a principal. */
function actorFor(principal: Principal): Actor {
  return {
    id: principal.id,
    ...(principal.email !== undefined ? { email: principal.email } : {}),
    ...(principal.name !== undefined ? { name: principal.name } : {}),
  };
}

/**
 * Handle an API request. `path` is already base-path-stripped. Returns a
 * `Response` for API/config routes, or `null` if the path is not an API route.
 */
export async function handleApiRequest(
  request: Request,
  path: string,
  ctx: ApiContext,
): Promise<Response | null> {
  const isApi =
    path === "/config" ||
    path === "/api/config" ||
    path === "/openapi.json" ||
    path.startsWith("/api/");
  if (!isApi) return null;

  const method = request.method.toUpperCase();

  // Public OpenAPI document (no auth) — for docs tooling and host-app merging.
  if (path === "/api/openapi.json" || path === "/openapi.json") {
    return json(buildOpenApiDocument({ basePath: ctx.basePath, title: ctx.title }));
  }

  // Public event catalog (no auth, CORS-open) — so receiver teams can read
  // which event types exist without panel credentials.
  if (path === "/api/event-types.json") {
    return new Response(JSON.stringify(await ctx.core.listEventTypes()), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*",
      },
    });
  }

  // --- Authentication ---
  // A portal token short-circuits the host's providers entirely: valid →
  // portal-scoped principal; invalid/expired → 401 (never fall back to the
  // host's auth with an explicitly presented, rejected credential). A throwing
  // auth provider is a backend failure (IdP down, DB error) — surfaced as 500,
  // not a misleading 401.
  const portal = ctx.portal;
  let who: Authenticated<PortalScope>;
  try {
    who = await authenticate<PortalScope>(request, {
      auth: ctx.auth,
      ...(portal
        ? {
            scoped: {
              prefix: PORTAL_TOKEN_PREFIX,
              verify: async (token) => ({
                applicationKey: (await verifyPortalToken(portal.secret, token)).applicationKey,
                allow: new Set(portal.allow ?? DEFAULT_PORTAL_ACTIONS),
              }),
              principal: ({ applicationKey }) => ({
                id: `portal:${applicationKey}`,
                metadata: { portal: true, applicationKey },
              }),
            },
          }
        : {}),
    });
  } catch (err) {
    return mapError(err);
  }
  const { principal, scoped: portalScope } = who;

  // Public bootstrap config (whether the client should show a login, whether
  // the SPA renders the reduced portal chrome, etc.).
  if (path === "/config" || path === "/api/config") {
    return json({
      title: ctx.title,
      basePath: ctx.basePath,
      readonly: ctx.readonly,
      authenticated: principal !== null,
      principal: principal
        ? { id: principal.id, email: principal.email, name: principal.name, roles: principal.roles }
        : null,
      portal: portalScope !== null,
      logoUrl: ctx.logoUrl,
    });
  }

  if (principal === null) {
    const challenge = ctx.auth.challenge?.(request);
    return challenge ?? error(401, "Unauthorized");
  }

  const authorize = async (
    action: WebhooksAction,
    resource: WebhooksResource,
  ): Promise<Response | null> => {
    const ok = await authorizeRequest(
      who,
      { action, resource, request },
      {
        authorization: ctx.authorization,
        // Defense in depth: the host's authorization provider is NOT consulted
        // for portal principals — the token's scope is the whole grant.
        scope: (grant, action, resource) => {
          if (!grant.allow.has(action)) return false;
          // Event types are a single GLOBAL catalog shared by every application,
          // so a token scoped to one application may only ever READ them — never
          // mutate the catalog other tenants depend on, even if the host widened
          // `portal.allow` to include event-type writes.
          if (resource.type === "event-type") return action === "event-type:read";
          return resource.applicationKey === grant.applicationKey;
        },
      },
    );
    return ok ? null : error(403, "Forbidden", { action });
  };

  const actor = actorFor(principal);
  const body = async <T>(): Promise<T> => (await request.json()) as T;

  try {
    // --- Applications ---
    if (path === "/api/applications") {
      if (method === "GET") {
        const denied = await authorize("application:read", {
          type: "application",
          applicationKey: "*",
        });
        if (denied) return denied;
        return json(await ctx.core.listApplications());
      }
      if (method === "POST") {
        const input = await body<{ key: string; name?: string; metadata?: JsonValue }>();
        const denied = await authorize("application:create", {
          type: "application",
          applicationKey: input.key,
        });
        if (denied) return denied;
        return json(await ctx.core.createApplication(input, { actor }), 201);
      }
    }

    let m = match("/api/applications/:app", path);
    if (m) {
      const app = m.params.app!;
      const resource: WebhooksResource = { type: "application", applicationKey: app };
      if (method === "GET") {
        const denied = await authorize("application:read", resource);
        if (denied) return denied;
        const application = await ctx.core.getApplication(app);
        return application ? json(application) : error(404, `application "${app}" not found`);
      }
      if (method === "PUT") {
        const patch = await body<{ name?: string; metadata?: JsonValue }>();
        const denied = await authorize("application:update", resource);
        if (denied) return denied;
        return json(await ctx.core.updateApplication(app, patch, { actor }));
      }
      if (method === "DELETE") {
        const denied = await authorize("application:delete", resource);
        if (denied) return denied;
        await ctx.core.deleteApplication(app, { actor });
        return json({ ok: true });
      }
    }

    // --- Event types (global catalog) ---
    if (path === "/api/event-types") {
      if (method === "GET") {
        const denied = await authorize("event-type:read", { type: "event-type", name: "*" });
        if (denied) return denied;
        return json(await ctx.core.listEventTypes());
      }
      if (method === "POST") {
        const input = await body<EventType>();
        const denied = await authorize("event-type:create", {
          type: "event-type",
          name: input.name,
        });
        if (denied) return denied;
        return json(await ctx.core.upsertEventType(input, { actor }), 201);
      }
    }

    m = match("/api/event-types/:name", path);
    if (m) {
      const name = m.params.name!;
      const resource: WebhooksResource = { type: "event-type", name };
      if (method === "GET") {
        const denied = await authorize("event-type:read", resource);
        if (denied) return denied;
        const eventType = await ctx.core.getEventType(name);
        return eventType ? json(eventType) : error(404, `event type "${name}" not found`);
      }
      if (method === "PUT") {
        const input = await body<EventType>();
        const denied = await authorize("event-type:update", resource);
        if (denied) return denied;
        return json(await ctx.core.upsertEventType({ ...input, name }, { actor }));
      }
      if (method === "DELETE") {
        const denied = await authorize("event-type:delete", resource);
        if (denied) return denied;
        await ctx.core.deleteEventType(name, { actor });
        return json({ ok: true });
      }
    }

    // --- Endpoints ---
    m = match("/api/applications/:app/endpoints", path);
    if (m) {
      const app = m.params.app!;
      if (method === "GET") {
        const denied = await authorize("endpoint:read", {
          type: "endpoint",
          applicationKey: app,
          endpointId: "*",
        });
        if (denied) return denied;
        return json((await ctx.core.listEndpoints(app)).map(withoutSecrets));
      }
      if (method === "POST") {
        const input = await body<{
          url: string;
          description?: string;
          eventTypes?: string[];
          headers?: Record<string, string>;
          metadata?: JsonValue;
          disabled?: boolean;
        }>();
        const denied = await authorize("endpoint:create", {
          type: "endpoint",
          applicationKey: app,
          endpointId: "*",
        });
        if (denied) return denied;
        // The one response that carries the signing secret — capture it now.
        return json(await ctx.core.createEndpoint(app, input, { actor }), 201);
      }
    }

    m = match("/api/applications/:app/endpoints/:id", path);
    if (m) {
      const app = m.params.app!;
      const id = m.params.id!;
      const resource: WebhooksResource = { type: "endpoint", applicationKey: app, endpointId: id };
      if (method === "GET") {
        const denied = await authorize("endpoint:read", resource);
        if (denied) return denied;
        const endpoint = await ctx.core.getEndpoint(app, id);
        return endpoint ? json(withoutSecrets(endpoint)) : error(404, `endpoint "${id}" not found`);
      }
      if (method === "PUT") {
        const patch = await body<{
          url?: string;
          description?: string;
          eventTypes?: string[];
          headers?: Record<string, string>;
          metadata?: JsonValue;
        }>();
        const denied = await authorize("endpoint:update", resource);
        if (denied) return denied;
        return json(withoutSecrets(await ctx.core.updateEndpoint(app, id, patch, { actor })));
      }
      if (method === "DELETE") {
        const denied = await authorize("endpoint:delete", resource);
        if (denied) return denied;
        await ctx.core.deleteEndpoint(app, id, { actor });
        return json({ ok: true });
      }
    }

    m = match("/api/applications/:app/endpoints/:id/secret", path);
    if (m && method === "GET") {
      const app = m.params.app!;
      const id = m.params.id!;
      const denied = await authorize("endpoint:read-secret", {
        type: "endpoint",
        applicationKey: app,
        endpointId: id,
      });
      if (denied) return denied;
      return json(await ctx.core.getSecrets(app, id));
    }

    m = match("/api/applications/:app/endpoints/:id/rotate-secret", path);
    if (m && method === "POST") {
      const app = m.params.app!;
      const id = m.params.id!;
      const denied = await authorize("endpoint:rotate-secret", {
        type: "endpoint",
        applicationKey: app,
        endpointId: id,
      });
      if (denied) return denied;
      // Like create, rotation mints a secret the caller must capture — the
      // response includes `secrets` (new current + graced predecessors).
      return json(await ctx.core.rotateSecret(app, id, { actor }));
    }

    m = match("/api/applications/:app/endpoints/:id/enable", path);
    if (m && method === "POST") {
      const app = m.params.app!;
      const id = m.params.id!;
      const denied = await authorize("endpoint:update", {
        type: "endpoint",
        applicationKey: app,
        endpointId: id,
      });
      if (denied) return denied;
      return json(withoutSecrets(await ctx.core.enableEndpoint(app, id, { actor })));
    }

    m = match("/api/applications/:app/endpoints/:id/disable", path);
    if (m && method === "POST") {
      const app = m.params.app!;
      const id = m.params.id!;
      const denied = await authorize("endpoint:update", {
        type: "endpoint",
        applicationKey: app,
        endpointId: id,
      });
      if (denied) return denied;
      return json(withoutSecrets(await ctx.core.disableEndpoint(app, id, { actor })));
    }

    // --- Send-example test delivery ---
    m = match("/api/applications/:app/endpoints/:id/test", path);
    if (m && method === "POST") {
      const app = m.params.app!;
      const id = m.params.id!;
      const denied = await authorize("endpoint:update", {
        type: "endpoint",
        applicationKey: app,
        endpointId: id,
      });
      if (denied) return denied;
      const input = await body<{ eventType: string; payload?: JsonValue }>();
      return json(await ctx.core.sendExample(app, id, input, { actor }));
    }

    // --- Recover (redrive failed deliveries since a timestamp) ---
    m = match("/api/applications/:app/endpoints/:id/recover", path);
    if (m && method === "POST") {
      const app = m.params.app!;
      const id = m.params.id!;
      const denied = await authorize("delivery:retry", {
        type: "delivery",
        applicationKey: app,
      });
      if (denied) return denied;
      const input = await body<{ since: string }>();
      return json(await ctx.core.recoverEndpoint(app, id, input, { actor }));
    }

    // --- Messages ---
    m = match("/api/applications/:app/messages", path);
    if (m) {
      const app = m.params.app!;
      if (method === "GET") {
        const denied = await authorize("message:read", { type: "message", applicationKey: app });
        if (denied) return denied;
        const url = new URL(request.url);
        const eventType = url.searchParams.get("eventType") ?? undefined;
        const before = url.searchParams.get("before") ?? undefined;
        const limit = intParam(url.searchParams.get("limit"), { invalid: "ignore" });
        return json(
          await ctx.core.listMessages(app, {
            ...(eventType !== undefined ? { eventType } : {}),
            ...(before !== undefined ? { before } : {}),
            ...(limit !== undefined ? { limit } : {}),
          }),
        );
      }
      if (method === "POST") {
        const input = await body<{
          eventType: string;
          payload: JsonValue;
          timestamp?: string;
          idempotencyKey?: string;
        }>();
        const denied = await authorize("message:publish", { type: "message", applicationKey: app });
        if (denied) return denied;
        // The `idempotency-key` header wins over the body field.
        const idempotencyKey = request.headers.get("idempotency-key") ?? input.idempotencyKey;
        const result = await ctx.core.publish(
          app,
          {
            eventType: input.eventType,
            payload: input.payload,
            ...(input.timestamp !== undefined ? { timestamp: input.timestamp } : {}),
            ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
          },
          { actor },
        );
        return json(result, result.deduplicated ? 200 : 201);
      }
    }

    m = match("/api/applications/:app/messages/:id", path);
    if (m && method === "GET") {
      const app = m.params.app!;
      const id = m.params.id!;
      const denied = await authorize("message:read", {
        type: "message",
        applicationKey: app,
        messageId: id,
      });
      if (denied) return denied;
      const message = await ctx.core.getMessage(app, id);
      if (!message) return error(404, `message "${id}" not found`);
      const deliveries = await ctx.core.listDeliveries(app, { messageId: id });
      return json({ ...message, deliveries });
    }

    // --- Deliveries ---
    m = match("/api/applications/:app/deliveries", path);
    if (m && method === "GET") {
      const app = m.params.app!;
      const denied = await authorize("delivery:read", { type: "delivery", applicationKey: app });
      if (denied) return denied;
      const url = new URL(request.url);
      const status = url.searchParams.get("status") ?? undefined;
      const endpointId = url.searchParams.get("endpoint") ?? undefined;
      const before = url.searchParams.get("before") ?? undefined;
      const limit = intParam(url.searchParams.get("limit"), { invalid: "ignore" });
      return json(
        await ctx.core.listDeliveries(app, {
          ...(status !== undefined ? { status: status as DeliveryStatus } : {}),
          ...(endpointId !== undefined ? { endpointId } : {}),
          ...(before !== undefined ? { before } : {}),
          ...(limit !== undefined ? { limit } : {}),
        }),
      );
    }

    m = match("/api/applications/:app/deliveries/:id", path);
    if (m && method === "GET") {
      const app = m.params.app!;
      const id = m.params.id!;
      const denied = await authorize("delivery:read", {
        type: "delivery",
        applicationKey: app,
        deliveryId: id,
      });
      if (denied) return denied;
      const found = await ctx.core.getDelivery(app, id);
      if (!found) return error(404, `delivery "${id}" not found`);
      return json({ ...found.delivery, attempts: found.attempts });
    }

    m = match("/api/applications/:app/deliveries/:id/request", path);
    if (m && method === "GET") {
      const app = m.params.app!;
      const id = m.params.id!;
      const denied = await authorize("delivery:read", {
        type: "delivery",
        applicationKey: app,
        deliveryId: id,
      });
      if (denied) return denied;
      const preview = await ctx.core.previewDeliveryRequest(app, id);
      if (!preview) return error(404, `delivery "${id}" not found (or its endpoint was deleted)`);
      return json(preview);
    }

    m = match("/api/applications/:app/deliveries/:id/retry", path);
    if (m && method === "POST") {
      const app = m.params.app!;
      const id = m.params.id!;
      const denied = await authorize("delivery:retry", {
        type: "delivery",
        applicationKey: app,
        deliveryId: id,
      });
      if (denied) return denied;
      return json(await ctx.core.retryDelivery(app, id, { actor }));
    }

    // --- Audit ---
    m = match("/api/applications/:app/audit", path);
    if (m && method === "GET") {
      const app = m.params.app!;
      const denied = await authorize("audit:read", { type: "audit", applicationKey: app });
      if (denied) return denied;
      return json(await ctx.core.listAudit(app));
    }

    return error(404, "Not found");
  } catch (err) {
    return mapError(err);
  }
}

/**
 * The webhooks error contract (status + `code`). Errors are matched by `name`,
 * so a class copy from another bundle still maps; `HookDeniedError` (its own
 * status, `HOOK_DENIED`) and `HttpError` are the kit built-ins.
 */
const ERROR_MAP: ErrorMap = {
  ReadonlyError: { status: 403, code: "READONLY" },
  PortalTokenError: { status: 401, code: "PORTAL_TOKEN" },
  NotFoundError: { status: 404 },
  IdempotencyConflictError: { status: 409, code: "IDEMPOTENCY_CONFLICT" },
  ConflictError: { status: 409, code: "CONFLICT" },
  PayloadTooLargeError: { status: 413, code: "PAYLOAD_TOO_LARGE" },
  ValidationError: {
    status: 422,
    code: "VALIDATION",
    extra: (e) => {
      const errors = (e as { errors?: unknown }).errors;
      return { errors: Array.isArray(errors) ? errors : [] };
    },
  },
  SyntaxError: () => error(400, "Invalid JSON body"),
};

/** Map domain errors to HTTP responses. */
function mapError(err: unknown): Response {
  return kitMapError(err, ERROR_MAP);
}
