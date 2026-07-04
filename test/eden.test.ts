import { describe, expect, test } from "vitest";
import { Elysia } from "elysia";
import { treaty } from "@elysiajs/eden";
import { webhooksElysia } from "../src/adapters/elysia.ts";
import { createMemoryStorage } from "../src/storage/memory.ts";

// Mounting the typed plugin under /webhooks gives Eden's treaty a typed surface:
// client.webhooks.api.applications({ app: "acme" }).endpoints.get(), etc.
const app = new Elysia().use(
  webhooksElysia({
    prefix: "/webhooks",
    storage: createMemoryStorage(),
    title: "Eden Test",
    dispatcher: false,
  }),
);
const client = treaty<typeof app>(app);
// Eden types the prefix group as optional; bind it once for ergonomic access.
const webhooks = client.webhooks!;
// Handlers delegate to a web Response, so Eden infers `data: Response`; cast via unknown.
const as = <T>(v: unknown): T => v as unknown as T;

describe("eden typed client", () => {
  test("reads bootstrap config via client.webhooks.config", async () => {
    const { data, error } = await webhooks.config.get();
    expect(error).toBeNull();
    expect(as<{ basePath: string }>(data).basePath).toBe("/webhooks");
    expect(as<{ title: string }>(data).title).toBe("Eden Test");
  });

  test("creates and lists applications through the typed path", async () => {
    const created = await webhooks.api.applications.post({ key: "acme", name: "Acme" });
    expect(created.response.status).toBe(201);

    const list = await webhooks.api.applications.get();
    expect(as<{ key: string }[]>(list.data).some((a) => a.key === "acme")).toBe(true);

    const one = await webhooks.api.applications({ app: "acme" }).get();
    expect(as<{ name: string }>(one.data).name).toBe("Acme");
  });

  test("manages the event-type catalog and endpoints through the typed path", async () => {
    const eventType = await webhooks.api["event-types"].post({
      name: "invoice.paid",
      description: "An invoice was paid",
    });
    expect(eventType.response.status).toBe(201);

    const endpoint = await webhooks.api
      .applications({ app: "acme" })
      .endpoints.post({ url: "https://acme.example.com/hooks", eventTypes: ["invoice.paid"] });
    expect(endpoint.response.status).toBe(201);
    // The one response that carries the signing secret.
    expect(as<{ secrets: { secret: string }[] }>(endpoint.data).secrets[0]!.secret).toMatch(
      /^whsec_/,
    );

    const endpoints = await webhooks.api.applications({ app: "acme" }).endpoints.get();
    expect(as<unknown[]>(endpoints.data).length).toBe(1);
  });

  test("publishes a message and reads deliveries through the typed path", async () => {
    const published = await webhooks.api
      .applications({ app: "acme" })
      .messages.post({ eventType: "invoice.paid", payload: { invoiceId: "inv_1" } });
    expect(published.response.status).toBe(201);
    expect(as<{ deliveries: unknown[] }>(published.data).deliveries.length).toBe(1);

    const deliveries = await webhooks.api.applications({ app: "acme" }).deliveries.get();
    expect(as<{ status: string }[]>(deliveries.data)[0]!.status).toBe("pending");
  });

  test("exposes the OpenAPI document", async () => {
    const res = await webhooks.api["openapi.json"].get();
    expect(as<{ openapi: string }>(res.data).openapi).toBe("3.1.0");
  });
});
