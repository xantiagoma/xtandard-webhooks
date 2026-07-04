import { describe, expect, test } from "vitest";
import { createWebhooksCore } from "../src/core.ts";
import { HookDeniedError } from "../src/hooks/contract.ts";
import { createFetchHandler } from "../src/server/create-fetch-handler.ts";
import { createMemoryStorage } from "../src/storage/memory.ts";
import { fakeFetch, failWith, ok } from "./fixtures.ts";

type PanelOptions = Parameters<typeof createFetchHandler>[0];
type Panel = ReturnType<typeof createFetchHandler>;

const panel = (opts: Partial<PanelOptions> = {}): Panel =>
  createFetchHandler({
    storage: createMemoryStorage(),
    dispatcher: false,
    ...opts,
  } as PanelOptions);

const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

/** App + event type + one endpoint; returns the created endpoint (with secrets). */
async function seed(fetch: Panel["fetch"]) {
  await fetch(req("POST", "/api/applications", { key: "acme", name: "Acme" }));
  await fetch(req("POST", "/api/event-types", { name: "invoice.paid" }));
  const res = await fetch(
    req("POST", "/api/applications/acme/endpoints", { url: "https://example.com/hooks" }),
  );
  return (await res.json()) as { id: string; secrets: { secret: string }[] };
}

describe("routes — applications", () => {
  test("POST creates an application (201)", async () => {
    const { fetch } = panel();
    const res = await fetch(req("POST", "/api/applications", { key: "acme", name: "Acme" }));
    expect(res.status).toBe(201);
    expect((await res.json()).key).toBe("acme");
  });

  test("POST a duplicate key → 409 CONFLICT", async () => {
    const { fetch } = panel();
    await fetch(req("POST", "/api/applications", { key: "acme" }));
    const res = await fetch(req("POST", "/api/applications", { key: "acme" }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("CONFLICT");
  });

  test("GET lists applications", async () => {
    const { fetch } = panel();
    await fetch(req("POST", "/api/applications", { key: "acme" }));
    const apps = await (await fetch(req("GET", "/api/applications"))).json();
    expect(apps.map((a: { key: string }) => a.key)).toEqual(["acme"]);
  });

  test("GET/PUT/DELETE a single application", async () => {
    const { fetch } = panel();
    await fetch(req("POST", "/api/applications", { key: "acme", name: "Acme" }));

    const got = await fetch(req("GET", "/api/applications/acme"));
    expect(got.status).toBe(200);
    expect((await got.json()).name).toBe("Acme");

    const updated = await fetch(req("PUT", "/api/applications/acme", { name: "Acme Inc" }));
    expect(updated.status).toBe(200);
    expect((await updated.json()).name).toBe("Acme Inc");

    const deleted = await fetch(req("DELETE", "/api/applications/acme"));
    expect((await deleted.json()).ok).toBe(true);
    expect((await fetch(req("GET", "/api/applications/acme"))).status).toBe(404);
  });

  test("GET a missing application → 404", async () => {
    const { fetch } = panel();
    const res = await fetch(req("GET", "/api/applications/ghost"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain("ghost");
  });
});

describe("routes — event types", () => {
  test("POST creates (201), PUT forces the name, DELETE removes", async () => {
    const { fetch } = panel();
    const created = await fetch(
      req("POST", "/api/event-types", { name: "invoice.paid", groupName: "Billing" }),
    );
    expect(created.status).toBe(201);

    const updated = await fetch(
      req("PUT", "/api/event-types/invoice.paid", { name: "ignored", description: "d" }),
    );
    expect(updated.status).toBe(200);
    const eventType = await updated.json();
    expect(eventType.name).toBe("invoice.paid");
    expect(eventType.description).toBe("d");

    const list = await (await fetch(req("GET", "/api/event-types"))).json();
    expect(list.length).toBe(1);

    expect((await (await fetch(req("DELETE", "/api/event-types/invoice.paid"))).json()).ok).toBe(
      true,
    );
    expect((await fetch(req("GET", "/api/event-types/invoice.paid"))).status).toBe(404);
  });

  test("GET /api/event-types.json is public with CORS open", async () => {
    // Auth rejects everyone — the catalog is still readable (public route).
    const storage = createMemoryStorage();
    const core = createWebhooksCore({ storage });
    await core.upsertEventType({ name: "invoice.paid", description: "An invoice was paid" });
    const { fetch } = panel({ storage, core, auth: { authenticate: async () => null } });
    const res = await fetch(req("GET", "/api/event-types.json"));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const catalog = await res.json();
    expect(catalog.map((t: { name: string }) => t.name)).toEqual(["invoice.paid"]);
  });
});

describe("routes — endpoints", () => {
  test("POST returns 201 and includes the secret once", async () => {
    const { fetch } = panel();
    const endpoint = await seed(fetch);
    expect(endpoint.id.startsWith("ep_")).toBe(true);
    expect(endpoint.secrets[0]!.secret.startsWith("whsec_")).toBe(true);
  });

  test("GET single and list strip secrets", async () => {
    const { fetch } = panel();
    const endpoint = await seed(fetch);

    const single = await fetch(req("GET", `/api/applications/acme/endpoints/${endpoint.id}`));
    expect(single.status).toBe(200);
    const got = await single.json();
    expect(got.id).toBe(endpoint.id);
    expect(got.secrets).toBeUndefined();

    const list = await (await fetch(req("GET", "/api/applications/acme/endpoints"))).json();
    expect(list.length).toBe(1);
    expect(list[0].secrets).toBeUndefined();
  });

  test("GET a missing endpoint → 404", async () => {
    const { fetch } = panel();
    await seed(fetch);
    expect((await fetch(req("GET", "/api/applications/acme/endpoints/ep_ghost"))).status).toBe(404);
  });

  test("the /secret route returns the secrets", async () => {
    const { fetch } = panel();
    const endpoint = await seed(fetch);
    const res = await fetch(req("GET", `/api/applications/acme/endpoints/${endpoint.id}/secret`));
    expect(res.status).toBe(200);
    const secrets = await res.json();
    expect(secrets.length).toBe(1);
    expect(secrets[0].secret).toBe(endpoint.secrets[0]!.secret);
  });

  test("rotate-secret mints a new current secret and graces the old one", async () => {
    const { fetch } = panel();
    const endpoint = await seed(fetch);
    const res = await fetch(
      req("POST", `/api/applications/acme/endpoints/${endpoint.id}/rotate-secret`),
    );
    expect(res.status).toBe(200);
    const rotated = await res.json();
    expect(rotated.secrets.length).toBe(2);
    expect(rotated.secrets[0].secret).not.toBe(endpoint.secrets[0]!.secret);
    expect(rotated.secrets[1].secret).toBe(endpoint.secrets[0]!.secret);
    expect(rotated.secrets[1].expiresAt).toBeDefined();
  });

  test("PUT updates and strips secrets; enable/disable round-trips", async () => {
    const { fetch } = panel();
    const endpoint = await seed(fetch);

    const updated = await fetch(
      req("PUT", `/api/applications/acme/endpoints/${endpoint.id}`, { description: "primary" }),
    );
    expect(updated.status).toBe(200);
    const body = await updated.json();
    expect(body.description).toBe("primary");
    expect(body.secrets).toBeUndefined();

    const disabled = await (
      await fetch(req("POST", `/api/applications/acme/endpoints/${endpoint.id}/disable`))
    ).json();
    expect(disabled.disabled).toBe(true);
    expect(disabled.disabledReason).toBe("manual");
    expect(disabled.secrets).toBeUndefined();

    const enabled = await (
      await fetch(req("POST", `/api/applications/acme/endpoints/${endpoint.id}/enable`))
    ).json();
    expect(enabled.disabled).toBeUndefined();
  });

  test("DELETE removes the endpoint", async () => {
    const { fetch } = panel();
    const endpoint = await seed(fetch);
    const res = await fetch(req("DELETE", `/api/applications/acme/endpoints/${endpoint.id}`));
    expect((await res.json()).ok).toBe(true);
    expect(
      (await fetch(req("GET", `/api/applications/acme/endpoints/${endpoint.id}`))).status,
    ).toBe(404);
  });

  test("an invalid endpoint URL → 422 VALIDATION with errors", async () => {
    const { fetch } = panel();
    await fetch(req("POST", "/api/applications", { key: "acme" }));
    const res = await fetch(
      req("POST", "/api/applications/acme/endpoints", { url: "http://not-localhost.example.com" }),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("VALIDATION");
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);
  });
});

describe("routes — publish & messages", () => {
  test("POST publishes (201) and fans out deliveries", async () => {
    const { fetch } = panel();
    await seed(fetch);
    const res = await fetch(
      req("POST", "/api/applications/acme/messages", {
        eventType: "invoice.paid",
        payload: { invoiceId: "inv_1" },
      }),
    );
    expect(res.status).toBe(201);
    const result = await res.json();
    expect(result.message.id.startsWith("msg_")).toBe(true);
    expect(result.deliveries.length).toBe(1);
    expect(result.deduplicated).toBe(false);
  });

  test("an unknown event type → 422", async () => {
    const { fetch } = panel();
    await seed(fetch);
    const res = await fetch(
      req("POST", "/api/applications/acme/messages", { eventType: "nope", payload: {} }),
    );
    expect(res.status).toBe(422);
  });

  test("the idempotency-key header dedupes (200, same message)", async () => {
    const { fetch } = panel();
    await seed(fetch);
    const publish = () =>
      fetch(
        req(
          "POST",
          "/api/applications/acme/messages",
          { eventType: "invoice.paid", payload: { n: 1 } },
          { "idempotency-key": "k1" },
        ),
      );
    const first = await publish();
    expect(first.status).toBe(201);
    const second = await publish();
    expect(second.status).toBe(200);
    const a = await first.json();
    const b = await second.json();
    expect(b.deduplicated).toBe(true);
    expect(b.message.id).toBe(a.message.id);
  });

  test("the header wins over the body idempotencyKey field", async () => {
    const { fetch } = panel();
    await seed(fetch);
    const first = await fetch(
      req(
        "POST",
        "/api/applications/acme/messages",
        { eventType: "invoice.paid", payload: { n: 1 } },
        { "idempotency-key": "k1" },
      ),
    );
    // Same header key but a different body key: still deduplicated via the header.
    const second = await fetch(
      req(
        "POST",
        "/api/applications/acme/messages",
        { eventType: "invoice.paid", payload: { n: 1 }, idempotencyKey: "k2" },
        { "idempotency-key": "k1" },
      ),
    );
    expect(second.status).toBe(200);
    expect((await second.json()).message.id).toBe((await first.json()).message.id);
  });

  test("the body idempotencyKey field works without the header", async () => {
    const { fetch } = panel();
    await seed(fetch);
    const body = { eventType: "invoice.paid", payload: { n: 1 }, idempotencyKey: "k9" };
    await fetch(req("POST", "/api/applications/acme/messages", body));
    const second = await fetch(req("POST", "/api/applications/acme/messages", body));
    expect(second.status).toBe(200);
    expect((await second.json()).deduplicated).toBe(true);
  });

  test("same key + different payload → 409 IDEMPOTENCY_CONFLICT", async () => {
    const { fetch } = panel();
    await seed(fetch);
    await fetch(
      req(
        "POST",
        "/api/applications/acme/messages",
        { eventType: "invoice.paid", payload: { n: 1 } },
        { "idempotency-key": "k1" },
      ),
    );
    const res = await fetch(
      req(
        "POST",
        "/api/applications/acme/messages",
        { eventType: "invoice.paid", payload: { n: 2 } },
        { "idempotency-key": "k1" },
      ),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("IDEMPOTENCY_CONFLICT");
  });

  test("GET lists messages with eventType filter and pagination", async () => {
    const { fetch } = panel();
    await seed(fetch);
    await fetch(req("POST", "/api/event-types", { name: "invoice.voided" }));
    for (const n of [1, 2, 3]) {
      await fetch(
        req("POST", "/api/applications/acme/messages", {
          eventType: "invoice.paid",
          payload: { n },
        }),
      );
    }
    await fetch(
      req("POST", "/api/applications/acme/messages", { eventType: "invoice.voided", payload: {} }),
    );

    const all = await (await fetch(req("GET", "/api/applications/acme/messages"))).json();
    expect(all.length).toBe(4);

    const filtered = await (
      await fetch(req("GET", "/api/applications/acme/messages?eventType=invoice.paid"))
    ).json();
    expect(filtered.length).toBe(3);

    const page1 = await (
      await fetch(req("GET", "/api/applications/acme/messages?eventType=invoice.paid&limit=2"))
    ).json();
    expect(page1.length).toBe(2);
    const page2 = await (
      await fetch(
        req(
          "GET",
          `/api/applications/acme/messages?eventType=invoice.paid&limit=2&before=${page1[1].id}`,
        ),
      )
    ).json();
    expect(page2.length).toBe(1);
    const ids = new Set([...page1, ...page2].map((m: { id: string }) => m.id));
    expect(ids.size).toBe(3);
  });

  test("GET a message includes its deliveries", async () => {
    const { fetch } = panel();
    await seed(fetch);
    const published = await (
      await fetch(
        req("POST", "/api/applications/acme/messages", {
          eventType: "invoice.paid",
          payload: { n: 1 },
        }),
      )
    ).json();
    const res = await fetch(req("GET", `/api/applications/acme/messages/${published.message.id}`));
    expect(res.status).toBe(200);
    const detail = await res.json();
    expect(detail.id).toBe(published.message.id);
    expect(detail.deliveries.length).toBe(1);
    expect(detail.deliveries[0].status).toBe("pending");
  });

  test("GET a missing message → 404", async () => {
    const { fetch } = panel();
    await seed(fetch);
    expect((await fetch(req("GET", "/api/applications/acme/messages/msg_ghost"))).status).toBe(404);
  });
});

describe("routes — deliveries", () => {
  async function publishSome(fetch: Panel["fetch"], count: number): Promise<string> {
    const endpointId = (await seed(fetch)).id;
    for (const n of Array.from({ length: count }, (_v, i) => i)) {
      await fetch(
        req("POST", "/api/applications/acme/messages", {
          eventType: "invoice.paid",
          payload: { n },
        }),
      );
    }
    return endpointId;
  }

  test("GET lists with status/endpoint filters and pagination", async () => {
    const { fetch } = panel();
    const endpointId = await publishSome(fetch, 3);

    const all = await (await fetch(req("GET", "/api/applications/acme/deliveries"))).json();
    expect(all.length).toBe(3);

    const pending = await (
      await fetch(req("GET", "/api/applications/acme/deliveries?status=pending"))
    ).json();
    expect(pending.length).toBe(3);

    const succeeded = await (
      await fetch(req("GET", "/api/applications/acme/deliveries?status=succeeded"))
    ).json();
    expect(succeeded.length).toBe(0);

    const byEndpoint = await (
      await fetch(req("GET", `/api/applications/acme/deliveries?endpoint=${endpointId}`))
    ).json();
    expect(byEndpoint.length).toBe(3);

    const byOther = await (
      await fetch(req("GET", "/api/applications/acme/deliveries?endpoint=ep_ghost"))
    ).json();
    expect(byOther.length).toBe(0);

    const page1 = await (
      await fetch(req("GET", "/api/applications/acme/deliveries?limit=2"))
    ).json();
    expect(page1.length).toBe(2);
    const page2 = await (
      await fetch(req("GET", `/api/applications/acme/deliveries?limit=2&before=${page1[1].id}`))
    ).json();
    expect(page2.length).toBe(1);
  });

  test("GET a delivery includes its attempts; missing → 404", async () => {
    const { fetch } = panel();
    await publishSome(fetch, 1);
    const [delivery] = await (await fetch(req("GET", "/api/applications/acme/deliveries"))).json();
    const res = await fetch(req("GET", `/api/applications/acme/deliveries/${delivery.id}`));
    expect(res.status).toBe(200);
    const detail = await res.json();
    expect(detail.id).toBe(delivery.id);
    expect(detail.attempts).toEqual([]);

    expect((await fetch(req("GET", "/api/applications/acme/deliveries/dlv_ghost"))).status).toBe(
      404,
    );
  });

  test("retry re-queues a dead-lettered delivery", async () => {
    const { fetch: failing } = fakeFetch(() => failWith(500));
    const p = panel({
      dispatcher: { fetch: failing, retrySchedule: ["0s"], pollIntervalMs: 3_600_000 },
    });
    await seed(p.fetch);
    await p.fetch(
      req("POST", "/api/applications/acme/messages", { eventType: "invoice.paid", payload: {} }),
    );
    await p.dispatcher!.tick(); // one attempt, schedule exhausted → dead-letter

    const [failed] = await (
      await p.fetch(req("GET", "/api/applications/acme/deliveries?status=failed"))
    ).json();
    expect(failed.status).toBe("failed");

    const retried = await p.fetch(
      req("POST", `/api/applications/acme/deliveries/${failed.id}/retry`),
    );
    expect(retried.status).toBe(200);
    expect((await retried.json()).status).toBe("pending");

    // Retrying a non-failed delivery → 422; a missing one → 404.
    expect(
      (await p.fetch(req("POST", `/api/applications/acme/deliveries/${failed.id}/retry`))).status,
    ).toBe(422);
    expect(
      (await p.fetch(req("POST", "/api/applications/acme/deliveries/dlv_ghost/retry"))).status,
    ).toBe(404);

    await p.dispatcher!.stop();
  });

  test("recover re-queues failed deliveries for an endpoint since a timestamp", async () => {
    const { fetch: failing } = fakeFetch(() => failWith(503));
    const p = panel({
      dispatcher: { fetch: failing, retrySchedule: ["0s"], pollIntervalMs: 3_600_000 },
    });
    const endpoint = await seed(p.fetch);
    await p.fetch(
      req("POST", "/api/applications/acme/messages", { eventType: "invoice.paid", payload: {} }),
    );
    await p.dispatcher!.tick();

    const res = await p.fetch(
      req("POST", `/api/applications/acme/endpoints/${endpoint.id}/recover`, {
        since: "1970-01-01T00:00:00.000Z",
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).deliveryIds.length).toBe(1);

    const invalid = await p.fetch(
      req("POST", `/api/applications/acme/endpoints/${endpoint.id}/recover`, { since: "nope" }),
    );
    expect(invalid.status).toBe(422);

    await p.dispatcher!.stop();
  });

  test("the test route sends a signed example through the injected fetch", async () => {
    const { fetch: fake, requests } = fakeFetch(() => ok());
    const storage = createMemoryStorage();
    const core = createWebhooksCore({ storage, dispatcher: { fetch: fake } });
    const p = panel({ storage, core });
    const endpoint = await seed(p.fetch);

    const res = await p.fetch(
      req("POST", `/api/applications/acme/endpoints/${endpoint.id}/test`, {
        eventType: "invoice.paid",
      }),
    );
    expect(res.status).toBe(200);
    const result = await res.json();
    expect(result.outcome.ok).toBe(true);
    expect(result.messageId.startsWith("msg_")).toBe(true);
    expect(requests.length).toBe(1);
    expect(requests[0]!.headers["webhook-id"]).toBe(result.messageId);
    expect(requests[0]!.headers["webhook-signature"]).toContain("v1,");
    expect(JSON.parse(requests[0]!.body).type).toBe("invoice.paid");
  });
});

describe("routes — config, openapi, dispatcher wiring", () => {
  test("GET /config reports title, auth state, and portal:false", async () => {
    const { fetch } = panel();
    const cfg = await (await fetch(req("GET", "/config"))).json();
    expect(cfg.title).toBe("@xtandard/webhooks");
    expect(cfg.readonly).toBe(false);
    expect(cfg.authenticated).toBe(true); // anonymous default auth
    expect(cfg.portal).toBe(false);
  });

  test("GET /config reflects custom title/logo/readonly and null auth", async () => {
    const { fetch } = panel({
      title: "Acme Hooks",
      logoUrl: "/logo.svg",
      readonly: true,
      auth: { authenticate: async () => null },
    });
    const cfg = await (await fetch(req("GET", "/config"))).json();
    expect(cfg.title).toBe("Acme Hooks");
    expect(cfg.logoUrl).toBe("/logo.svg");
    expect(cfg.readonly).toBe(true);
    expect(cfg.authenticated).toBe(false);
    expect(cfg.principal).toBeNull();
  });

  test("GET /api/openapi.json serves the document; openapi() returns it too", async () => {
    const p = panel({ basePath: "/webhooks", title: "Acme Hooks" });
    const res = await p.fetch(req("GET", "/webhooks/api/openapi.json"));
    expect(res.status).toBe(200);
    const doc = await res.json();
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.paths["/api/applications"]).toBeDefined();
    expect(doc.paths["/api/applications/{app}/deliveries/{id}/retry"]).toBeDefined();
    expect(doc.components.securitySchemes.basicAuth.scheme).toBe("basic");
    expect(doc.components.securitySchemes.bearerAuth.scheme).toBe("bearer");
    expect(doc.servers[0].url).toBe("/webhooks");
    expect(p.openapi()).toEqual(doc);
  });

  test("the panel starts a dispatcher by default and delivers on tick", async () => {
    const { fetch: fake, requests } = fakeFetch(() => ok());
    const p = createFetchHandler({
      storage: createMemoryStorage(),
      dispatcher: { fetch: fake, pollIntervalMs: 3_600_000 },
    });
    expect(p.dispatcher).not.toBeNull();
    expect(p.dispatcher!.running).toBe(true);

    await seed(p.fetch);
    await p.fetch(
      req("POST", "/api/applications/acme/messages", { eventType: "invoice.paid", payload: {} }),
    );
    expect(await p.dispatcher!.tick()).toBe(1);
    expect(requests.length).toBe(1);

    const succeeded = await (
      await p.fetch(req("GET", "/api/applications/acme/deliveries?status=succeeded"))
    ).json();
    expect(succeeded.length).toBe(1);
    await p.dispatcher!.stop();
  });

  test("dispatcher: false skips dispatcher creation", () => {
    const p = panel();
    expect(p.dispatcher).toBeNull();
  });

  test("GET audit lists control-plane entries", async () => {
    const { fetch } = panel();
    await seed(fetch);
    const audit = await (await fetch(req("GET", "/api/applications/acme/audit"))).json();
    expect(audit.length).toBeGreaterThan(0);
    expect(audit.some((e: { action: string }) => e.action === "endpoint.create")).toBe(true);
  });
});

describe("routes — error mappings", () => {
  test("invalid JSON body → 400", async () => {
    const { fetch } = panel();
    const res = await fetch(
      new Request("http://localhost/api/applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{ not json",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Invalid JSON");
  });

  test("readonly mutation → 403 READONLY", async () => {
    const { fetch } = panel({ readonly: true });
    const res = await fetch(req("POST", "/api/applications", { key: "acme" }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("READONLY");
  });

  test("payload over the limit → 413", async () => {
    const storage = createMemoryStorage();
    const core = createWebhooksCore({ storage, payloadLimitBytes: 16 });
    const { fetch } = panel({ storage, core });
    await seed(fetch);
    const res = await fetch(
      req("POST", "/api/applications/acme/messages", {
        eventType: "invoice.paid",
        payload: { blob: "x".repeat(64) },
      }),
    );
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe("PAYLOAD_TOO_LARGE");
  });

  test("a HookDeniedError surfaces its custom status", async () => {
    const { fetch } = panel({
      hooks: {
        before(event) {
          if (event.type === "message.publish") {
            throw new HookDeniedError("Monthly quota exceeded.", { status: 429 });
          }
        },
      },
    });
    await seed(fetch);
    const res = await fetch(
      req("POST", "/api/applications/acme/messages", { eventType: "invoice.paid", payload: {} }),
    );
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("HOOK_DENIED");
  });

  test("a plain Error from a before hook → 500", async () => {
    const { fetch } = panel({
      hooks: {
        before() {
          throw new Error("boom");
        },
      },
    });
    const res = await fetch(req("POST", "/api/applications", { key: "acme" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("boom");
  });

  test("unauthenticated without a challenge → 401", async () => {
    const { fetch } = panel({ auth: { authenticate: async () => null } });
    const res = await fetch(req("GET", "/api/applications"));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Unauthorized");
  });

  test("auth that throws is treated as unauthenticated", async () => {
    const { fetch } = panel({
      auth: {
        authenticate: async () => {
          throw new Error("boom");
        },
      },
    });
    expect((await fetch(req("GET", "/api/applications"))).status).toBe(401);
  });

  test("unknown /api route → 404", async () => {
    const { fetch } = panel();
    const res = await fetch(req("GET", "/api/nonexistent"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Not found");
  });
});

describe("routes — CORS", () => {
  test("OPTIONS preflight answers 204 with the CORS headers", async () => {
    const { fetch } = panel({ cors: { origin: "*" } });
    const res = await fetch(
      new Request("http://localhost/api/applications", {
        method: "OPTIONS",
        headers: { origin: "https://app.example.com" },
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });

  test("responses carry Access-Control-Allow-Origin for allowed origins", async () => {
    const { fetch } = panel({ cors: { origin: ["https://app.example.com"] } });
    const allowed = await fetch(
      new Request("http://localhost/config", { headers: { origin: "https://app.example.com" } }),
    );
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://app.example.com");

    const denied = await fetch(
      new Request("http://localhost/config", { headers: { origin: "https://evil.example.com" } }),
    );
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("routes — base path, SPA, and method handling", () => {
  test("the API is served under a mount prefix", async () => {
    const { fetch } = panel({ basePath: "/webhooks" });
    const cfg = await (await fetch(req("GET", "/webhooks/config"))).json();
    expect(cfg.basePath).toBe("/webhooks");
    expect((await fetch(req("GET", "/webhooks/api/applications"))).status).toBe(200);
  });

  test("non-GET to a non-API path → 405", async () => {
    const { fetch } = panel();
    expect((await fetch(req("POST", "/some/non-api/path"))).status).toBe(405);
  });

  test("SPA fallback injects __WEBHOOKS_CONFIG__ and <base>", async () => {
    const { fetch } = panel({ basePath: "/webhooks", title: "Acme Hooks" });
    const res = await fetch(req("GET", "/webhooks/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("__WEBHOOKS_CONFIG__");
    expect(html).toContain('<base href="/webhooks/">');
    expect(html).toContain("Acme Hooks");
  });

  test("a missing asset-looking path → 404 instead of the SPA", async () => {
    const { fetch } = panel();
    expect((await fetch(req("GET", "/assets/nope.js"))).status).toBe(404);
  });
});
