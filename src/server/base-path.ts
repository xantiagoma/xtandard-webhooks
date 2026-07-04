/**
 * Base-path helpers. The panel can be mounted under any prefix (`/webhooks`,
 * `/admin/webhooks`, ...). These normalize the configured base path and strip it
 * from incoming request paths so routing is prefix-agnostic.
 *
 * @module
 */

/** Normalize a base path to either `""` (root) or `/segment` with no trailing slash. */
export function normalizeBasePath(basePath: string | undefined): string {
  if (!basePath || basePath === "/") return "";
  let p = basePath.trim();
  if (!p.startsWith("/")) p = "/" + p;
  if (p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

/**
 * Strip the (normalized) base path from a pathname. Returns a path that always
 * starts with `/`. If the pathname does not start with the base path it is
 * returned unchanged (the host framework may already have stripped the mount).
 */
export function stripBasePath(pathname: string, basePath: string): string {
  if (basePath === "") return pathname || "/";
  if (pathname === basePath) return "/";
  if (pathname.startsWith(basePath + "/")) {
    const rest = pathname.slice(basePath.length);
    return rest || "/";
  }
  return pathname || "/";
}
