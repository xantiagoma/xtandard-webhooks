// Runs in the `elysia2` vitest project: `elysia` → the elysia-v2 devDep alias
// (see vite.config.ts + tsconfig.elysia2.json). Elysia 2's Eden is `@elysia/eden`.
import { describe, expect, test } from "vitest";
import { Elysia, t } from "elysia";
import { treaty } from "@elysia/eden";
import { webhooksElysia, webhooksPanel } from "../src/adapters/elysia2.ts";
import { createMemoryStorage } from "../src/storage/memory.ts";

const app = new Elysia().use(
  webhooksElysia({
    prefix: "/webhooks",
    storage: createMemoryStorage(),
    title: "Eden v2",
    dispatcher: false,
  }),
);
const client = treaty<typeof app>(app);
const webhooks = client.webhooks!;
// Handlers delegate to a web Response, so Eden infers `data: Response`; cast via unknown.
const as = <T>(v: unknown): T => v as unknown as T;

describe("elysia 2 adapter", () => {
  test("runs against Elysia 2 (rejects the 1.x handler-then-hook order)", () => {
    const legacy = () =>
      // the 1.x order type-checks on v2, but Elysia 2 throws on it at registration
      new Elysia().post("/x", () => "x", { body: t.Object({ k: t.String() }) });
    expect(legacy).toThrow(/1\.x order/);
  });

  test("webhooksPanel mounts under a prefix", async () => {
    const panel = webhooksPanel({
      storage: createMemoryStorage(),
      basePath: "/webhooks",
      dispatcher: false,
    });
    const mounted = new Elysia().mount("/webhooks", panel);
    const res = await mounted.handle(new Request("http://x/webhooks/config"));
    expect((await res.json()).basePath).toBe("/webhooks");
    expect(panel.dispatcher).toBeNull();
  });

  test("reads bootstrap config via client.webhooks.config", async () => {
    const { data, error } = await webhooks.config.get();
    expect(error).toBeNull();
    expect(as<{ title: string }>(data).title).toBe("Eden v2");
  });

  test("creates an app, event type and endpoint, then publishes through the typed path", async () => {
    const created = await webhooks.api.applications.post({ key: "acme", name: "Acme" });
    expect(created.response.status).toBe(201);

    const eventType = await webhooks.api["event-types"].post({ name: "invoice.paid" });
    expect(eventType.response.status).toBe(201);

    const acme = webhooks.api.applications({ app: "acme" });
    const endpoint = await acme.endpoints.post({
      url: "https://acme.example.com/hooks",
      eventTypes: ["invoice.paid"],
    });
    expect(endpoint.response.status).toBe(201);

    const published = await acme.messages.post({
      eventType: "invoice.paid",
      payload: { invoiceId: "inv_1" },
    });
    expect(published.response.status).toBe(201);
    expect(as<{ deliveries: unknown[] }>(published.data).deliveries.length).toBe(1);

    const deliveries = await acme.deliveries.get();
    expect(as<{ status: string }[]>(deliveries.data)[0]!.status).toBe("pending");
  });

  test("validates declared bodies", async () => {
    const res = await app.handle(
      new Request("http://x/webhooks/api/applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "missing key" }),
      }),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  test("serves the bundled UI catch-all", async () => {
    const res = await app.handle(new Request("http://x/webhooks/"));
    expect(res.status).toBeLessThan(500);
  });
});
