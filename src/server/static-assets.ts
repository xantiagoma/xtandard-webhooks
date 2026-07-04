/**
 * Serves the bundled SPA's static assets from the UI output directory. Maps file
 * extensions to content types and guards against path traversal.
 *
 * @module
 */

import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function contentType(path: string): string {
  const dot = path.lastIndexOf(".");
  const ext = dot >= 0 ? path.slice(dot).toLowerCase() : "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/** True if the path has a file extension (so a miss should 404 rather than fall through to the SPA). */
export function looksLikeAsset(path: string): boolean {
  const last = path.split("/").pop() ?? "";
  return last.includes(".");
}

/**
 * Try to serve `path` (base-path-stripped, leading `/`) as a static file from
 * `uiDir`. Returns a `Response`, or `null` if the file does not exist.
 */
export async function serveStaticAsset(uiDir: string, path: string): Promise<Response | null> {
  // Resolve within uiDir and refuse anything that escapes it.
  const rel = normalize(path).replace(/^(\.\.(\/|\\|$))+/, "");
  const full = join(uiDir, rel);
  if (!full.startsWith(normalize(uiDir))) return null;
  try {
    const data = await readFile(full);
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        "content-type": contentType(full),
        "cache-control": rel.includes("/assets/")
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      },
    });
  } catch {
    return null;
  }
}
