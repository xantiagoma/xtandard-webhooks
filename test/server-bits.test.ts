import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeBasePath, stripBasePath } from "../src/server/base-path.ts";
import { applyCorsHeaders, preflightResponse } from "../src/server/cors.ts";
import { looksLikeAsset, serveStaticAsset } from "../src/server/static-assets.ts";
import { renderIndexHtml } from "../src/server/render-index-html.ts";

describe("base-path", () => {
  it("normalizes assorted inputs to a canonical form", () => {
    expect(normalizeBasePath(undefined)).toBe("");
    expect(normalizeBasePath("")).toBe("");
    expect(normalizeBasePath("/")).toBe("");
    expect(normalizeBasePath("webhooks")).toBe("/webhooks");
    expect(normalizeBasePath("/webhooks/")).toBe("/webhooks");
  });

  it("strips the base path from a pathname", () => {
    expect(stripBasePath("/webhooks/api/config", "/webhooks")).toBe("/api/config");
    expect(stripBasePath("/webhooks", "/webhooks")).toBe("/");
    expect(stripBasePath("/api/config", "")).toBe("/api/config");
    expect(stripBasePath("/other/x", "/webhooks")).toBe("/other/x");
  });
});

describe("looksLikeAsset", () => {
  it("is true only when the last segment has a dot", () => {
    expect(looksLikeAsset("/assets/app.js")).toBe(true);
    expect(looksLikeAsset("/favicon.ico")).toBe(true);
    expect(looksLikeAsset("/deliveries/dlv_1")).toBe(false);
    expect(looksLikeAsset("/")).toBe(false);
  });
});

describe("serveStaticAsset", () => {
  const uiDir = join(mkdtempSync(join(tmpdir(), "xtw-ui-")), "ui");

  it("serves a file with its content-type and a long-cache header under /assets/", async () => {
    await mkdir(join(uiDir, "assets"), { recursive: true });
    await writeFile(join(uiDir, "assets", "app.js"), "console.log(1)");
    await writeFile(join(uiDir, "favicon.ico"), "icon");

    const js = await serveStaticAsset(uiDir, "/assets/app.js");
    expect(js?.status).toBe(200);
    expect(js?.headers.get("content-type")).toContain("text/javascript");
    expect(js?.headers.get("cache-control")).toContain("immutable");

    const ico = await serveStaticAsset(uiDir, "/favicon.ico");
    expect(ico?.headers.get("content-type")).toBe("image/x-icon");
    expect(ico?.headers.get("cache-control")).toBe("no-cache");
  });

  it("returns null for a missing file and for traversal attempts", async () => {
    expect(await serveStaticAsset(uiDir, "/nope.js")).toBeNull();
    expect(await serveStaticAsset(uiDir, "/../../etc/passwd")).toBeNull();
  });

  it("uses the octet-stream fallback for unknown extensions", async () => {
    await writeFile(join(uiDir, "data.bin"), "x");
    const res = await serveStaticAsset(uiDir, "/data.bin");
    expect(res?.headers.get("content-type")).toBe("application/octet-stream");
  });
});

describe("renderIndexHtml", () => {
  it("injects config + base into a built index.html", async () => {
    const uiDir = join(mkdtempSync(join(tmpdir(), "xtw-idx-")), "ui");
    await mkdir(uiDir, { recursive: true });
    await writeFile(join(uiDir, "index.html"), "<html><head></head><body>hi</body></html>");
    const html = await renderIndexHtml(uiDir, {
      title: "Acme",
      basePath: "/webhooks",
      readonly: false,
    });
    expect(html).toContain('<base href="/webhooks/">');
    expect(html).toContain("window.__WEBHOOKS_CONFIG__=");
    expect(html).toContain('"title":"Acme"');
  });

  it("falls back to a built-in page when no index.html exists", async () => {
    const html = await renderIndexHtml("/no/such/dir", {
      title: "Acme",
      basePath: "",
      readonly: true,
    });
    expect(html).toContain('<base href="/">');
    expect(html).toContain("bun run build:ui");
    expect(html).toContain("window.__WEBHOOKS_CONFIG__=");
  });
});

describe("cors", () => {
  const req = (origin?: string, reqHeaders?: string) =>
    new Request("http://api.example.com/x", {
      method: "OPTIONS",
      headers: {
        ...(origin ? { origin } : {}),
        ...(reqHeaders ? { "access-control-request-headers": reqHeaders } : {}),
      },
    });

  it("wildcard without credentials returns *", () => {
    const res = applyCorsHeaders(req("https://a.com"), new Response("ok"), { origin: "*" });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("vary")).toBeNull(); // no Vary for blanket *
  });

  it("wildcard with credentials echoes the caller origin + Vary + credentials", () => {
    const res = applyCorsHeaders(req("https://a.com"), new Response("ok"), {
      origin: "*",
      credentials: true,
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://a.com");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("matches string, array, and predicate origins; denies the rest", () => {
    expect(
      applyCorsHeaders(req("https://a.com"), new Response(), {
        origin: "https://a.com",
      }).headers.get("access-control-allow-origin"),
    ).toBe("https://a.com");
    expect(
      applyCorsHeaders(req("https://b.com"), new Response(), {
        origin: ["https://a.com", "https://b.com"],
      }).headers.get("access-control-allow-origin"),
    ).toBe("https://b.com");
    expect(
      applyCorsHeaders(req("https://c.com"), new Response(), {
        origin: (o) => o.endsWith(".com"),
      }).headers.get("access-control-allow-origin"),
    ).toBe("https://c.com");
    // Mismatch / no Origin header → no CORS header at all.
    expect(
      applyCorsHeaders(req("https://evil.net"), new Response(), {
        origin: "https://a.com",
      }).headers.get("access-control-allow-origin"),
    ).toBeNull();
    expect(
      applyCorsHeaders(req(), new Response(), { origin: "https://a.com" }).headers.get(
        "access-control-allow-origin",
      ),
    ).toBeNull();
  });

  it("preflight is a 204 with methods/headers/max-age", () => {
    const def = preflightResponse(req("https://a.com", "x-custom, content-type"), {
      origin: "*",
    });
    expect(def.status).toBe(204);
    expect(def.headers.get("access-control-allow-methods")).toContain("POST");
    // Reflects the requested headers when none are configured.
    expect(def.headers.get("access-control-allow-headers")).toBe("x-custom, content-type");

    const custom = preflightResponse(req("https://a.com"), {
      origin: "*",
      methods: ["GET", "POST"],
      headers: ["authorization"],
      maxAge: 600,
    });
    expect(custom.headers.get("access-control-allow-methods")).toBe("GET,POST");
    expect(custom.headers.get("access-control-allow-headers")).toBe("authorization");
    expect(custom.headers.get("access-control-max-age")).toBe("600");

    // No configured/ requested headers → the documented default.
    expect(
      preflightResponse(req("https://a.com"), { origin: "*" }).headers.get(
        "access-control-allow-headers",
      ),
    ).toBe("Content-Type, Authorization");
  });
});
