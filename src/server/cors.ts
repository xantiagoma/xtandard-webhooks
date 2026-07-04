/**
 * Framework-independent CORS for the mounted panel. When `webhooksPanel` /
 * `createFetchHandler` is given a `cors` option, the handler answers `OPTIONS`
 * preflights itself and attaches `Access-Control-*` headers to every response —
 * so a **cross-origin embed** (portal on `app.example.com`, panel on
 * `api.example.com`) works even if the host framework's CORS middleware does not
 * wrap the mounted sub-handler.
 *
 * @module
 */

/** CORS configuration for the panel handler. */
export interface WebhooksCorsOptions {
  /**
   * Allowed origin(s): a single origin (`"https://app.example.com"`), `"*"`, a
   * list, or a predicate `(origin) => boolean`. With `credentials: true`, `"*"`
   * is echoed back as the caller's exact origin (the browser forbids `*` +
   * credentials).
   */
  origin: string | string[] | ((origin: string) => boolean);
  /** Send `Access-Control-Allow-Credentials: true` (needed for cookie auth). Default `false`. */
  credentials?: boolean;
  /** Allowed methods advertised in preflight. Default `GET,HEAD,PUT,POST,DELETE,PATCH,OPTIONS`. */
  methods?: string[];
  /**
   * Allowed request headers advertised in preflight. Default: reflect the
   * request's `Access-Control-Request-Headers`, falling back to
   * `Content-Type, Authorization`.
   */
  headers?: string[];
  /** `Access-Control-Max-Age` (seconds) for the preflight cache. */
  maxAge?: number;
}

const DEFAULT_METHODS = "GET,HEAD,PUT,POST,DELETE,PATCH,OPTIONS";

/**
 * Resolve the value for `Access-Control-Allow-Origin` for this request, or
 * `null` when the origin is not allowed (no CORS headers → the browser blocks).
 */
function resolveOrigin(cors: WebhooksCorsOptions, requestOrigin: string | null): string | null {
  const { origin } = cors;
  if (origin === "*") {
    // `*` + credentials is invalid; echo the caller's origin instead.
    return cors.credentials ? (requestOrigin ?? null) : "*";
  }
  if (requestOrigin === null) return null;
  const allowed =
    typeof origin === "string"
      ? origin === requestOrigin
      : Array.isArray(origin)
        ? origin.includes(requestOrigin)
        : origin(requestOrigin);
  return allowed ? requestOrigin : null;
}

/** Attach `Access-Control-*` headers to `response` for an allowed cross-origin request. */
export function applyCorsHeaders(
  request: Request,
  response: Response,
  cors: WebhooksCorsOptions,
): Response {
  const requestOrigin = request.headers.get("origin");
  const allowOrigin = resolveOrigin(cors, requestOrigin);
  if (allowOrigin === null) return response;
  response.headers.set("access-control-allow-origin", allowOrigin);
  if (cors.credentials) response.headers.set("access-control-allow-credentials", "true");
  // The response varies by Origin unless we blanket-allow `*` — tell caches.
  if (allowOrigin !== "*") response.headers.append("vary", "Origin");
  return response;
}

/** Build the `204` response for a CORS preflight (`OPTIONS`). */
export function preflightResponse(request: Request, cors: WebhooksCorsOptions): Response {
  const response = new Response(null, { status: 204 });
  applyCorsHeaders(request, response, cors);
  response.headers.set(
    "access-control-allow-methods",
    (cors.methods ?? []).join(",") || DEFAULT_METHODS,
  );
  const requestedHeaders = request.headers.get("access-control-request-headers");
  response.headers.set(
    "access-control-allow-headers",
    cors.headers?.join(",") || requestedHeaders || "Content-Type, Authorization",
  );
  if (cors.maxAge !== undefined) {
    response.headers.set("access-control-max-age", String(cors.maxAge));
  }
  return response;
}
