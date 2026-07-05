/**
 * Tests for the webhook-testing tools: the `sign` command (signature
 * playground), the `formatInboundWebhook` printer behind `listen`, the shared
 * `buildSignedRequest` primitive, and the panel's request-inspector route.
 *
 * @module
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { formatInboundWebhook, run } from "../src/cli.ts";
import { buildSignedRequest } from "../src/deliver.ts";
import { createFetchHandler } from "../src/server/create-fetch-handler.ts";
import { generateSecret, verify } from "../src/signing.ts";
import { createMemoryStorage } from "../src/storage/memory.ts";
import type { Endpoint } from "../src/schema.ts";

describe("formatInboundWebhook", () => {
  const base = {
    index: 1,
    method: "POST",
    path: "/hooks",
    headers: {
      "webhook-id": "msg_1",
      "webhook-timestamp": "1720000000",
      "webhook-signature": "v1,abc",
    },
    body: '{"a":1}',
    at: "2026-07-04T12:00:00.000Z",
  };

  test("renders the Standard Webhooks headers and pretty-prints JSON", () => {
    const out = formatInboundWebhook({ ...base, verification: { state: "unchecked" } });
    expect(out).toContain("POST /hooks");
    expect(out).toContain("webhook-id:        msg_1");
    expect(out).toContain("not checked");
    expect(out).toContain('"a": 1'); // pretty-printed
  });

  test("shows a VERIFIED / FAILED badge", () => {
    expect(formatInboundWebhook({ ...base, verification: { state: "ok" } })).toContain(
      "signature: VERIFIED",
    );
    const failed = formatInboundWebhook({
      ...base,
      verification: { state: "failed", reason: "No matching signature" },
    });
    expect(failed).toContain("signature: FAILED (No matching signature)");
  });

  test("leaves non-JSON bodies as-is", () => {
    const out = formatInboundWebhook({
      ...base,
      body: "not json",
      verification: { state: "unchecked" },
    });
    expect(out).toContain("not json");
  });
});

describe("buildSignedRequest", () => {
  test("produces a request a receiver verifies, without sending", async () => {
    const secret = generateSecret();
    const endpoint = {
      id: "ep_1",
      url: "https://api.example.com/hooks",
      headers: { "x-tenant": "acme" },
      secrets: [{ secret, createdAt: new Date().toISOString() }],
    } as Endpoint;
    const nowMs = 1_720_000_000_000;
    const req = await buildSignedRequest({
      endpoint,
      messageId: "msg_1",
      body: '{"type":"t","timestamp":"now","data":1}',
      nowMs,
    });
    expect(req.method).toBe("POST");
    expect(req.url).toBe(endpoint.url);
    expect(req.headers["x-tenant"]).toBe("acme"); // static headers merged
    expect(req.headers["webhook-id"]).toBe("msg_1");
    expect(req.headers["webhook-timestamp"]).toBe(String(Math.floor(nowMs / 1000)));
    await expect(
      verify({
        payload: req.body,
        headers: req.headers,
        secret,
        now: Math.floor(nowMs / 1000),
      }),
    ).resolves.toBeDefined();
  });

  test("throws when the endpoint has no unexpired signing secret", async () => {
    const endpoint = {
      id: "ep_1",
      url: "https://api.example.com/hooks",
      secrets: [
        {
          secret: generateSecret(),
          createdAt: "2020-01-01T00:00:00.000Z",
          expiresAt: "2020-01-02T00:00:00.000Z",
        },
      ],
    } as Endpoint;
    await expect(
      buildSignedRequest({ endpoint, messageId: "msg_1", body: "{}", nowMs: 1_720_000_000_000 }),
    ).rejects.toThrow("no unexpired signing secret");
  });
});

describe("panel request-inspector route", () => {
  test("returns the exact signed request; verifies with the endpoint secret", async () => {
    const storage = createMemoryStorage();
    const { fetch, core } = createFetchHandler({ storage, dispatcher: false });
    await core.createApplication({ key: "acme" });
    await core.upsertEventType({ name: "invoice.paid" });
    const endpoint = await core.createEndpoint("acme", { url: "https://api.example.com/hooks" });
    const { deliveries } = await core.publish("acme", {
      eventType: "invoice.paid",
      payload: { n: 1 },
    });
    const deliveryId = deliveries[0]!.id;

    const res = await fetch(
      new Request(`http://x/api/applications/acme/deliveries/${deliveryId}/request`),
    );
    expect(res.status).toBe(200);
    const req = (await res.json()) as {
      method: string;
      url: string;
      headers: Record<string, string>;
      body: string;
    };
    expect(req.method).toBe("POST");
    expect(req.url).toBe(endpoint.url);
    expect(req.headers["webhook-id"]).toMatch(/^msg_/);
    const secret = (await core.getSecrets("acme", endpoint.id))[0]!.secret;
    await expect(
      verify({
        payload: req.body,
        headers: req.headers,
        secret,
        now: Number(req.headers["webhook-timestamp"]),
      }),
    ).resolves.toMatchObject({ type: "invoice.paid" });
  });

  test("404 for an unknown delivery", async () => {
    const storage = createMemoryStorage();
    const { fetch, core } = createFetchHandler({ storage, dispatcher: false });
    await core.createApplication({ key: "acme" });
    const res = await fetch(
      new Request("http://x/api/applications/acme/deliveries/dlv_missing/request"),
    );
    expect(res.status).toBe(404);
  });

  test("404 when the delivery's endpoint was deleted", async () => {
    const storage = createMemoryStorage();
    const { fetch, core } = createFetchHandler({ storage, dispatcher: false });
    await core.createApplication({ key: "acme" });
    await core.upsertEventType({ name: "e.t" });
    const endpoint = await core.createEndpoint("acme", { url: "https://api.example.com/hooks" });
    const { deliveries } = await core.publish("acme", { eventType: "e.t", payload: 1 });
    await core.deleteEndpoint("acme", endpoint.id); // message stays, endpoint gone
    const res = await fetch(
      new Request(`http://x/api/applications/acme/deliveries/${deliveries[0]!.id}/request`),
    );
    expect(res.status).toBe(404);
    // The core method returns null directly for this case.
    expect(await core.previewDeliveryRequest("acme", deliveries[0]!.id)).toBeNull();
  });
});

describe("createFetchHandler is unaffected by these additions", () => {
  test("no dispatcher leak (dispatcher:false)", async () => {
    const { dispatcher } = createFetchHandler({
      storage: createMemoryStorage(),
      dispatcher: false,
    });
    expect(dispatcher).toBeNull();
  });
});

describe("sign command (signature playground)", () => {
  let out: string[];
  let err: string[];
  beforeEach(() => {
    out = [];
    err = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => (out.push(String(s)), true));
    vi.spyOn(process.stderr, "write").mockImplementation((s) => (err.push(String(s)), true));
  });
  afterEach(() => vi.restoreAllMocks());

  test("prints headers whose signature verifies, and a curl with --url", async () => {
    const secret = generateSecret();
    const code = await run([
      "sign",
      "--secret",
      secret,
      "--data",
      '{"hello":"world"}',
      "--id",
      "msg_fixed",
      "--timestamp",
      "1720000000",
      "--url",
      "http://localhost:4000/hooks",
    ]);
    expect(code).toBe(0);
    const text = out.join("");
    expect(text).toContain("webhook-id: msg_fixed");
    expect(text).toContain("webhook-timestamp: 1720000000");
    expect(text).toContain("curl -X POST http://localhost:4000/hooks");

    // Extract the printed signature and confirm it verifies.
    const sig = /webhook-signature: (v1,[^\n]+)/.exec(text)?.[1];
    expect(sig).toBeDefined();
    await expect(
      verify({
        payload: '{"hello":"world"}',
        headers: {
          "webhook-id": "msg_fixed",
          "webhook-timestamp": "1720000000",
          "webhook-signature": sig!,
        },
        secret,
        now: 1720000000,
      }),
    ).resolves.toEqual({ hello: "world" });
  });

  test("rejects missing args and non-JSON data", async () => {
    expect(await run(["sign", "--secret", "whsec_x"])).toBe(1);
    expect(await run(["sign", "--secret", "whsec_x", "--data", "not json"])).toBe(1);
    expect(err.join("")).toContain("Invalid --data");
  });
});
