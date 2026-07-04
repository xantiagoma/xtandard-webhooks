import { describe, expect, test } from "vitest";
import { webhooksPanel as bunPanel } from "../src/adapters/bun.ts";
import { webhooksPanel as elysiaPanel } from "../src/adapters/elysia.ts";
import { webhooksPanel as honoPanel } from "../src/adapters/hono.ts";
import { createMemoryStorage } from "../src/storage/memory.ts";

describe("bun adapter", () => {
  test("returns a fetch handler with core, dispatcher, and openapi", async () => {
    const panel = bunPanel({ storage: createMemoryStorage(), dispatcher: false });
    expect(typeof panel.fetch).toBe("function");
    expect(panel.core).toBeDefined();
    expect(panel.dispatcher).toBeNull(); // dispatcher: false → no dispatcher
    expect(panel.openapi()).toMatchObject({ openapi: "3.1.0" });
    const res = await panel.fetch(new Request("http://x/config"));
    expect(res.status).toBe(200);
  });

  test("starts a dispatcher by default (embedded deployment shape)", async () => {
    const panel = bunPanel({ storage: createMemoryStorage() });
    expect(panel.dispatcher).not.toBeNull();
    expect(panel.dispatcher!.running).toBe(true);
    await panel.dispatcher!.stop(); // leave the runner clean
  });
});

describe("elysia adapter", () => {
  test("returns a request->response function with the extras attached", async () => {
    const handler = elysiaPanel({
      storage: createMemoryStorage(),
      basePath: "/webhooks",
      dispatcher: false,
    });
    expect(typeof handler).toBe("function");
    expect(handler.core).toBeDefined();
    expect(handler.dispatcher).toBeNull();
    expect(typeof handler.openapi).toBe("function");
    const res = await handler(new Request("http://x/webhooks/config"));
    expect((await res.json()).basePath).toBe("/webhooks");
  });
});

describe("hono adapter", () => {
  test("mounts under a route prefix", async () => {
    const { Hono } = await import("hono");
    const app = new Hono();
    app.route(
      "/webhooks",
      honoPanel({ storage: createMemoryStorage(), basePath: "/webhooks", dispatcher: false }),
    );
    const res = await app.request("/webhooks/config");
    expect(res.status).toBe(200);
    expect((await res.json()).basePath).toBe("/webhooks");
  });

  test("serves the JSON API through hono", async () => {
    const { Hono } = await import("hono");
    const app = new Hono();
    const panel = honoPanel({
      storage: createMemoryStorage(),
      basePath: "/webhooks",
      dispatcher: false,
    });
    app.route("/webhooks", panel);
    const create = await app.request("/webhooks/api/applications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "acme", name: "Acme" }),
    });
    expect(create.status).toBe(201);
    const list = await app.request("/webhooks/api/applications");
    expect(((await list.json()) as { key: string }[]).map((a) => a.key)).toEqual(["acme"]);
    // The same core is reachable on the sub-app for host-side publish().
    expect(await panel.core.getApplication("acme")).not.toBeNull();
    expect(panel.dispatcher).toBeNull();
  });
});
