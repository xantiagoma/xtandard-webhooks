import { afterAll, beforeAll, describe, expect, test } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { webhooksPanel } from "../src/adapters/express.ts";
import { createMemoryStorage } from "../src/storage/memory.ts";

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.get("/", (_req, res) => res.send("app"));
  app.use(
    "/webhooks",
    webhooksPanel({ basePath: "/webhooks", storage: createMemoryStorage(), dispatcher: false }),
  );
  // A mount where an upstream body parser consumes the stream first, so the
  // adapter must re-serialize req.body (the `req.readableEnded` branch).
  app.use(
    "/parsed",
    express.json(),
    webhooksPanel({ basePath: "/parsed", storage: createMemoryStorage(), dispatcher: false }),
  );
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = `http://localhost:${port}`;
});

afterAll(() => {
  server?.close();
});

describe("express adapter", () => {
  test("serves bootstrap config under the mount path", async () => {
    const res = await fetch(`${base}/webhooks/config`);
    expect(res.status).toBe(200);
    expect((await res.json()).basePath).toBe("/webhooks");
  });

  test("does not interfere with the host app", async () => {
    const res = await fetch(`${base}/`);
    expect(await res.text()).toBe("app");
  });

  test("handles a POST with a JSON body (raw stream)", async () => {
    const res = await fetch(`${base}/webhooks/api/applications`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "acme", name: "Acme" }),
    });
    expect(res.status).toBe(201);
    const list = await fetch(`${base}/webhooks/api/applications`);
    expect(((await list.json()) as unknown[]).length).toBe(1);
  });

  test("serves the SPA fallback", async () => {
    const res = await fetch(`${base}/webhooks/anything`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  test("re-serializes a body already parsed by express.json()", async () => {
    const res = await fetch(`${base}/parsed/api/applications`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "acme", name: "Acme" }),
    });
    expect(res.status).toBe(201);
    const list = await fetch(`${base}/parsed/api/applications`);
    expect(((await list.json()) as unknown[]).length).toBe(1);
  });

  test("attaches the admin core, dispatcher, and openapi to the handler", () => {
    const handler = webhooksPanel({ storage: createMemoryStorage(), dispatcher: false });
    expect(handler.core).toBeDefined();
    expect(typeof handler.core.listApplications).toBe("function");
    expect(handler.dispatcher).toBeNull();
    expect(handler.openapi()).toMatchObject({ openapi: "3.1.0" });
  });
});
