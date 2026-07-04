import { describe, expect, test } from "vitest";
import { basicAuth } from "../src/auth/basic.ts";
import { rolesAuthorization } from "../src/authorization/roles.ts";
import type { WebhooksCore } from "../src/core.ts";
import { createPortalToken } from "../src/portal.ts";
import { createFetchHandler } from "../src/server/create-fetch-handler.ts";
import { createMemoryStorage } from "../src/storage/memory.ts";

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

const basic = (username: string, password: string) => ({
  authorization: "Basic " + btoa(`${username}:${password}`),
});

const PORTAL_SECRET = "portal-secret-for-tests";
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** Seed two applications, an event type, and one endpoint per app via the core. */
async function seedTwoApps(core: WebhooksCore) {
  await core.createApplication({ key: "acme" });
  await core.createApplication({ key: "other" });
  await core.upsertEventType({ name: "invoice.paid" });
  const acmeEndpoint = await core.createEndpoint("acme", { url: "https://acme.example.com/hooks" });
  const otherEndpoint = await core.createEndpoint("other", {
    url: "https://other.example.com/hooks",
  });
  return { acmeEndpoint, otherEndpoint };
}

describe("routes — basic auth", () => {
  const users = [
    { username: "root", password: "s3cret", roles: ["admin"] },
    { username: "vera", password: "v13w", roles: ["viewer"] },
    { username: "eddy", password: "3d1t", roles: ["editor"] },
  ];
  const authedPanel = () =>
    panel({
      auth: basicAuth({ users, realm: "Webhooks Admin" }),
      authorization: rolesAuthorization(),
    });

  test("no credentials → 401 with the WWW-Authenticate challenge", async () => {
    const { fetch } = authedPanel();
    const res = await fetch(req("GET", "/api/applications"));
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe('Basic realm="Webhooks Admin"');
  });

  test("a wrong password → 401", async () => {
    const { fetch } = authedPanel();
    const res = await fetch(req("GET", "/api/applications", undefined, basic("root", "wrong")));
    expect(res.status).toBe(401);
  });

  test("/config reports the authenticated principal", async () => {
    const { fetch } = authedPanel();
    const cfg = await (
      await fetch(req("GET", "/config", undefined, basic("root", "s3cret")))
    ).json();
    expect(cfg.authenticated).toBe(true);
    expect(cfg.principal.id).toBe("root");
    expect(cfg.principal.roles).toEqual(["admin"]);
  });

  test("admin can mutate; viewer can read but not write", async () => {
    const { fetch } = authedPanel();
    const created = await fetch(
      req("POST", "/api/applications", { key: "acme" }, basic("root", "s3cret")),
    );
    expect(created.status).toBe(201);

    const list = await fetch(req("GET", "/api/applications", undefined, basic("vera", "v13w")));
    expect(list.status).toBe(200);

    const denied = await fetch(
      req("POST", "/api/applications", { key: "nope" }, basic("vera", "v13w")),
    );
    expect(denied.status).toBe(403);
    expect((await denied.json()).action).toBe("application:create");
  });

  test("viewer is denied the secret route; editor is allowed", async () => {
    const { fetch, core } = authedPanel();
    const { acmeEndpoint } = await seedTwoApps(core);
    const path = `/api/applications/acme/endpoints/${acmeEndpoint.id}/secret`;

    const viewer = await fetch(req("GET", path, undefined, basic("vera", "v13w")));
    expect(viewer.status).toBe(403);
    expect((await viewer.json()).action).toBe("endpoint:read-secret");

    const editor = await fetch(req("GET", path, undefined, basic("eddy", "3d1t")));
    expect(editor.status).toBe(200);
  });

  test("audit is attributed to the acting principal", async () => {
    const { fetch } = authedPanel();
    await fetch(req("POST", "/api/applications", { key: "acme" }, basic("root", "s3cret")));
    const audit = await (
      await fetch(req("GET", "/api/applications/acme/audit", undefined, basic("root", "s3cret")))
    ).json();
    expect(audit[0].by.id).toBe("root");
  });
});

describe("routes — portal tokens", () => {
  const portalPanel = (opts: Partial<PanelOptions> = {}) =>
    panel({ portal: { secret: PORTAL_SECRET }, ...opts });

  test("a valid token completes the portal journey: config, endpoints, deliveries", async () => {
    const p = portalPanel();
    const { acmeEndpoint } = await seedTwoApps(p.core);
    await p.core.publish("acme", { eventType: "invoice.paid", payload: { n: 1 } });
    const token = await createPortalToken(PORTAL_SECRET, "acme");

    const cfg = await (await p.fetch(req("GET", "/config", undefined, bearer(token)))).json();
    expect(cfg.portal).toBe(true);
    expect(cfg.authenticated).toBe(true);
    expect(cfg.principal.id).toBe("portal:acme");

    const endpoints = await (
      await p.fetch(req("GET", "/api/applications/acme/endpoints", undefined, bearer(token)))
    ).json();
    expect(endpoints.map((e: { id: string }) => e.id)).toEqual([acmeEndpoint.id]);
    expect(endpoints[0].secrets).toBeUndefined();

    const created = await p.fetch(
      req(
        "POST",
        "/api/applications/acme/endpoints",
        { url: "https://portal.example.com/hooks" },
        bearer(token),
      ),
    );
    expect(created.status).toBe(201);
    expect((await created.json()).secrets[0].secret.startsWith("whsec_")).toBe(true);

    const deliveries = await (
      await p.fetch(req("GET", "/api/applications/acme/deliveries", undefined, bearer(token)))
    ).json();
    expect(deliveries.length).toBe(1);

    const messages = await (
      await p.fetch(req("GET", "/api/applications/acme/messages", undefined, bearer(token)))
    ).json();
    expect(messages.length).toBe(1);

    const catalog = await p.fetch(req("GET", "/api/event-types", undefined, bearer(token)));
    expect(catalog.status).toBe(200);
  });

  test("cross-application access is denied (403)", async () => {
    const p = portalPanel();
    const { otherEndpoint } = await seedTwoApps(p.core);
    const token = await createPortalToken(PORTAL_SECRET, "acme");

    const cases: [string, string][] = [
      ["GET", "/api/applications/other/endpoints"],
      ["GET", `/api/applications/other/endpoints/${otherEndpoint.id}`],
      ["GET", "/api/applications/other/deliveries"],
      ["GET", "/api/applications/other/messages"],
    ];
    for (const [method, path] of cases) {
      const res = await p.fetch(req(method, path, undefined, bearer(token)));
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });

  test("actions outside the portal grant are denied (403)", async () => {
    const p = portalPanel();
    await seedTwoApps(p.core);
    const token = await createPortalToken(PORTAL_SECRET, "acme");

    // application:delete, message:publish, audit:read, and the cross-app
    // application list are all outside the default portal grant.
    const del = await p.fetch(req("DELETE", "/api/applications/acme", undefined, bearer(token)));
    expect(del.status).toBe(403);

    const publish = await p.fetch(
      req(
        "POST",
        "/api/applications/acme/messages",
        { eventType: "invoice.paid", payload: {} },
        bearer(token),
      ),
    );
    expect(publish.status).toBe(403);
    expect((await publish.json()).action).toBe("message:publish");

    const audit = await p.fetch(
      req("GET", "/api/applications/acme/audit", undefined, bearer(token)),
    );
    expect(audit.status).toBe(403);

    const listApps = await p.fetch(req("GET", "/api/applications", undefined, bearer(token)));
    expect(listApps.status).toBe(403);

    const upsertType = await p.fetch(
      req("POST", "/api/event-types", { name: "x.y" }, bearer(token)),
    );
    expect(upsertType.status).toBe(403);
  });

  test("the default grant allows secret reads, rotation, and retry within the app", async () => {
    const p = portalPanel();
    const { acmeEndpoint } = await seedTwoApps(p.core);
    const token = await createPortalToken(PORTAL_SECRET, "acme");

    const secret = await p.fetch(
      req(
        "GET",
        `/api/applications/acme/endpoints/${acmeEndpoint.id}/secret`,
        undefined,
        bearer(token),
      ),
    );
    expect(secret.status).toBe(200);

    const rotated = await p.fetch(
      req(
        "POST",
        `/api/applications/acme/endpoints/${acmeEndpoint.id}/rotate-secret`,
        undefined,
        bearer(token),
      ),
    );
    expect(rotated.status).toBe(200);

    // Authorized retry that reaches the core (404 = passed authorization).
    const retry = await p.fetch(
      req("POST", "/api/applications/acme/deliveries/dlv_ghost/retry", undefined, bearer(token)),
    );
    expect(retry.status).toBe(404);
  });

  test("a custom allow list narrows the grant", async () => {
    const p = panel({ portal: { secret: PORTAL_SECRET, allow: ["endpoint:read"] } });
    await seedTwoApps(p.core);
    const token = await createPortalToken(PORTAL_SECRET, "acme");

    expect(
      (await p.fetch(req("GET", "/api/applications/acme/endpoints", undefined, bearer(token))))
        .status,
    ).toBe(200);
    expect(
      (
        await p.fetch(
          req(
            "POST",
            "/api/applications/acme/endpoints",
            { url: "https://x.example.com/h" },
            bearer(token),
          ),
        )
      ).status,
    ).toBe(403);
  });

  test("an expired token → 401", async () => {
    const p = portalPanel();
    await seedTwoApps(p.core);
    const token = await createPortalToken(PORTAL_SECRET, "acme", { expiresIn: 0 });
    const res = await p.fetch(
      req("GET", "/api/applications/acme/endpoints", undefined, bearer(token)),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("PORTAL_TOKEN");
  });

  test("a tampered token → 401", async () => {
    const p = portalPanel();
    await seedTwoApps(p.core);
    const token = await createPortalToken(PORTAL_SECRET, "acme");
    const flipped = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    const res = await p.fetch(
      req("GET", "/api/applications/acme/endpoints", undefined, bearer(flipped)),
    );
    expect(res.status).toBe(401);
  });

  test("a token minted with the wrong secret → 401", async () => {
    const p = portalPanel();
    await seedTwoApps(p.core);
    const token = await createPortalToken("some-other-secret", "acme");
    const res = await p.fetch(
      req("GET", "/api/applications/acme/endpoints", undefined, bearer(token)),
    );
    expect(res.status).toBe(401);
  });

  test("the host's authorization provider is not consulted for portal principals", async () => {
    const p = panel({
      portal: { secret: PORTAL_SECRET },
      authorization: { authorize: async () => false }, // denies everything
    });
    await seedTwoApps(p.core);
    const token = await createPortalToken(PORTAL_SECRET, "acme");

    // The host's deny-all blocks a normal (anonymous) request…
    expect((await p.fetch(req("GET", "/api/applications/acme/endpoints"))).status).toBe(403);
    // …but the portal grant stands on its own.
    expect(
      (await p.fetch(req("GET", "/api/applications/acme/endpoints", undefined, bearer(token))))
        .status,
    ).toBe(200);
  });

  test("a non-portal bearer token falls through to the host's auth", async () => {
    const p = panel({
      portal: { secret: PORTAL_SECRET },
      auth: {
        authenticate: async (request) =>
          request.headers.get("authorization") === "Bearer host-token" ? { id: "host-user" } : null,
      },
    });
    await seedTwoApps(p.core);

    expect(
      (await p.fetch(req("GET", "/api/applications", undefined, bearer("host-token")))).status,
    ).toBe(200);
    expect((await p.fetch(req("GET", "/api/applications"))).status).toBe(401);
  });

  test("without the portal option a whpt_ bearer is just an unknown credential", async () => {
    const p = panel({ auth: { authenticate: async () => null } });
    const token = await createPortalToken(PORTAL_SECRET, "acme");
    const res = await p.fetch(
      req("GET", "/api/applications/acme/endpoints", undefined, bearer(token)),
    );
    expect(res.status).toBe(401);
  });
});
