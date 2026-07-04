/**
 * Renders the SPA `index.html`: injects a `<base>` tag so relative asset URLs
 * resolve under any mount path, and a bootstrap `window.__WEBHOOKS_CONFIG__`
 * blob. Falls back to a minimal built-in page when the UI bundle is absent
 * (e.g. before `bun run build:ui`, or in headless tests).
 *
 * @module
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Bootstrap config injected into the page and exposed at `/config`. */
export interface BootstrapConfig {
  title: string;
  basePath: string;
  readonly: boolean;
  /** Optional logo image URL shown in the navbar in place of the title wordmark. */
  logoUrl?: string;
}

const escapeJson = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");

/** Build the `<base href>` value (always ends in `/`). */
function baseHref(basePath: string): string {
  return basePath === "" ? "/" : `${basePath}/`;
}

function injectInto(html: string, config: BootstrapConfig): string {
  const tags =
    `<base href="${baseHref(config.basePath)}">` +
    `<script>window.__WEBHOOKS_CONFIG__=${escapeJson(config)}</script>`;
  if (html.includes("<head>")) return html.replace("<head>", `<head>${tags}`);
  return tags + html;
}

/** Minimal page served when no built UI is present. */
function fallbackHtml(config: BootstrapConfig): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${baseHref(
    config.basePath,
  )}"><title>${config.title}</title><script>window.__WEBHOOKS_CONFIG__=${escapeJson(
    config,
  )}</script></head><body style="font-family:system-ui;margin:0;padding:3rem;background:#0a0a0a;color:#e5e5e5"><h1 style="margin:0 0 .5rem">${
    config.title
  }</h1><p style="color:#a3a3a3">The admin UI bundle is not built. Run <code style="background:#1a1a1a;padding:2px 6px;border-radius:4px">bun run build:ui</code>. The JSON API at <code style="background:#1a1a1a;padding:2px 6px;border-radius:4px">api/</code> is fully available.</p></body></html>`;
}

/** Read, inject into, and return the SPA index HTML (or a fallback). */
export async function renderIndexHtml(uiDir: string, config: BootstrapConfig): Promise<string> {
  try {
    const html = await readFile(join(uiDir, "index.html"), "utf8");
    return injectInto(html, config);
  } catch {
    return fallbackHtml(config);
  }
}
