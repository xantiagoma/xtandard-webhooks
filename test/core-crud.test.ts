import { describe, expect, it } from "vitest";
import { ConflictError, NotFoundError, ReadonlyError } from "../src/core.ts";
import { HookDeniedError } from "../src/hooks/contract.ts";
import { ValidationError } from "../src/validation.ts";
import { setupWebhooks } from "./fixtures.ts";

describe("applications", () => {
  it("creates, lists, gets, updates, deletes", async () => {
    const { core } = setupWebhooks();
    const app = await core.createApplication({ key: "acme", name: "Acme" });
    expect(app.createdAt).toBeDefined();
    expect(await core.listApplications()).toEqual([app]);
    expect(await core.getApplication("acme")).toEqual(app);

    const updated = await core.updateApplication("acme", { name: "Acme Corp" });
    expect(updated.name).toBe("Acme Corp");
    expect(updated.createdAt).toBe(app.createdAt);

    await core.deleteApplication("acme");
    expect(await core.getApplication("acme")).toBeNull();
    expect(await core.listApplications()).toEqual([]);
  });

  it("rejects duplicates with ConflictError", async () => {
    const { core } = setupWebhooks();
    await core.createApplication({ key: "acme" });
    await expect(core.createApplication({ key: "acme" })).rejects.toThrow(ConflictError);
  });

  it("validates keys", async () => {
    const { core } = setupWebhooks();
    await expect(core.createApplication({ key: "bad key" })).rejects.toThrow(ValidationError);
    await expect(core.createApplication({ key: "event-types" })).rejects.toThrow("reserved");
  });

  it("update/delete of a missing application throws NotFoundError", async () => {
    const { core } = setupWebhooks();
    await expect(core.updateApplication("nope", {})).rejects.toThrow(NotFoundError);
    await expect(core.deleteApplication("nope")).rejects.toThrow(NotFoundError);
  });

  it("delete cascades everything under the application", async () => {
    const { core, storage } = setupWebhooks();
    await core.createApplication({ key: "acme" });
    await core.upsertEventType({ name: "e.t" });
    await core.createEndpoint("acme", { url: "https://x.example/h" });
    await core.publish("acme", { eventType: "e.t", payload: { a: 1 } });
    await core.deleteApplication("acme");
    expect(await storage.getKeys("whk/acme/")).toEqual([]);
    // The global event type catalog is untouched.
    expect(await core.getEventType("e.t")).not.toBeNull();
  });
});

describe("event types", () => {
  it("upserts (create then update) and deletes", async () => {
    const { core } = setupWebhooks();
    const created = await core.upsertEventType({ name: "invoice.paid", groupName: "Billing" });
    expect(created.createdAt).toBeDefined();
    const updated = await core.upsertEventType({ name: "invoice.paid", description: "paid!" });
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.description).toBe("paid!");
    expect(updated.groupName).toBe("Billing"); // merge, not replace

    expect((await core.listEventTypes()).map((t) => t.name)).toEqual(["invoice.paid"]);
    await core.deleteEventType("invoice.paid");
    expect(await core.listEventTypes()).toEqual([]);
    await expect(core.deleteEventType("invoice.paid")).rejects.toThrow(NotFoundError);
  });

  it("lists sorted by name", async () => {
    const { core } = setupWebhooks();
    await core.upsertEventType({ name: "b.two" });
    await core.upsertEventType({ name: "a.one" });
    expect((await core.listEventTypes()).map((t) => t.name)).toEqual(["a.one", "b.two"]);
  });
});

describe("endpoints", () => {
  it("creates with a generated id + secret, updates, deletes", async () => {
    const { core } = setupWebhooks();
    await core.createApplication({ key: "acme" });
    const endpoint = await core.createEndpoint("acme", {
      url: "https://receiver.example/hooks",
      eventTypes: ["invoice.paid"],
      headers: { "x-tenant": "acme" },
    });
    expect(endpoint.id).toMatch(/^ep_/);
    expect(endpoint.secrets.length).toBe(1);
    expect(endpoint.secrets[0]?.secret).toMatch(/^whsec_/);

    const updated = await core.updateEndpoint("acme", endpoint.id, {
      description: "Main receiver",
      eventTypes: [],
    });
    expect(updated.description).toBe("Main receiver");
    expect(updated.eventTypes).toEqual([]);
    expect(updated.secrets).toEqual(endpoint.secrets); // update cannot touch secrets

    await core.deleteEndpoint("acme", endpoint.id);
    expect(await core.getEndpoint("acme", endpoint.id)).toBeNull();
    await expect(core.deleteEndpoint("acme", endpoint.id)).rejects.toThrow(NotFoundError);
  });

  it("enforces the URL policy", async () => {
    const { core } = setupWebhooks({ allowInsecureUrls: false });
    await core.createApplication({ key: "acme" });
    await expect(
      core.createEndpoint("acme", { url: "http://insecure.example/hooks" }),
    ).rejects.toThrow(ValidationError);
    // localhost is exempt even with the strict default.
    await expect(
      core.createEndpoint("acme", { url: "http://localhost:9999/hooks" }),
    ).resolves.toBeDefined();
  });

  it("rotates secrets with a grace window and prunes expired ones", async () => {
    const { core, clock } = setupWebhooks({ secretRotationGrace: "24h" });
    await core.createApplication({ key: "acme" });
    const endpoint = await core.createEndpoint("acme", { url: "https://x.example/h" });
    const original = endpoint.secrets[0]?.secret;

    const rotated = await core.rotateSecret("acme", endpoint.id);
    expect(rotated.secrets.length).toBe(2);
    expect(rotated.secrets[0]?.secret).not.toBe(original);
    expect(rotated.secrets[1]?.secret).toBe(original);
    const expiresAt = Date.parse(rotated.secrets[1]?.expiresAt ?? "");
    expect(expiresAt).toBe(clock.now() + 24 * 3_600_000);

    // After the grace elapses, the next rotation prunes the expired secret.
    clock.advance(25 * 3_600_000);
    const again = await core.rotateSecret("acme", endpoint.id);
    expect(again.secrets.length).toBe(2); // new current + previous-current; original gone
    expect(again.secrets.some((s) => s.secret === original)).toBe(false);
  });

  it("enables and disables with reasons; enable clears the failure streak", async () => {
    const { core } = setupWebhooks();
    await core.createApplication({ key: "acme" });
    const endpoint = await core.createEndpoint("acme", { url: "https://x.example/h" });
    const disabled = await core.disableEndpoint("acme", endpoint.id);
    expect(disabled.disabled).toBe(true);
    expect(disabled.disabledReason).toBe("manual");

    const enabled = await core.enableEndpoint("acme", endpoint.id);
    expect(enabled.disabled).toBeUndefined();
    expect(enabled.disabledReason).toBeUndefined();
    expect(enabled.firstFailingAt).toBeNull();
  });

  it("getSecrets returns the secret list", async () => {
    const { core } = setupWebhooks();
    await core.createApplication({ key: "acme" });
    const endpoint = await core.createEndpoint("acme", { url: "https://x.example/h" });
    const secrets = await core.getSecrets("acme", endpoint.id);
    expect(secrets).toEqual(endpoint.secrets);
  });
});

describe("audit log", () => {
  it("records control-plane mutations newest-first, per app and globally", async () => {
    const { core } = setupWebhooks();
    await core.createApplication({ key: "acme" }, { actor: { id: "u1", name: "Ana" } });
    await core.upsertEventType({ name: "e.t" });
    const endpoint = await core.createEndpoint("acme", { url: "https://x.example/h" });
    await core.disableEndpoint("acme", endpoint.id);

    const appAudit = await core.listAudit("acme");
    expect(appAudit.map((e) => e.action)).toEqual([
      "endpoint.disable",
      "endpoint.create",
      "application.create",
    ]);
    expect(appAudit[2]?.by).toEqual({ id: "u1", name: "Ana" });

    const all = await core.listAudit();
    expect(all.map((e) => e.action)).toContain("event-type.create");
    expect(all.length).toBe(4);
  });

  it("publishes are not audited (data plane)", async () => {
    const { core } = setupWebhooks();
    await core.createApplication({ key: "acme" });
    await core.upsertEventType({ name: "e.t" });
    await core.publish("acme", { eventType: "e.t", payload: null });
    const audit = await core.listAudit("acme");
    expect(audit.map((e) => e.action)).toEqual(["application.create"]);
  });
});

describe("readonly mode", () => {
  it("rejects every mutation but allows reads", async () => {
    const seeded = setupWebhooks();
    await seeded.core.createApplication({ key: "acme" });
    const { core } = setupWebhooks({ storage: seeded.storage, readonly: true });

    await expect(core.createApplication({ key: "x" })).rejects.toThrow(ReadonlyError);
    await expect(core.upsertEventType({ name: "e.t" })).rejects.toThrow(ReadonlyError);
    await expect(core.createEndpoint("acme", { url: "https://x.example" })).rejects.toThrow(
      ReadonlyError,
    );
    await expect(core.publish("acme", { eventType: "e", payload: 1 })).rejects.toThrow(
      ReadonlyError,
    );
    expect((await core.listApplications()).length).toBe(1);
  });
});

describe("hooks around mutations", () => {
  it("before hooks run sequentially and can veto; nothing commits", async () => {
    const order: string[] = [];
    const { core } = setupWebhooks({
      hooks: [
        {
          before: (e) => {
            order.push(`first:${e.type}`);
          },
        },
        {
          before: (e) => {
            order.push(`second:${e.type}`);
            if (e.type === "application.create" && e.application.key === "denied") {
              throw new HookDeniedError("not today");
            }
          },
        },
      ],
    });
    await core.createApplication({ key: "allowed" });
    await expect(core.createApplication({ key: "denied" })).rejects.toThrow(HookDeniedError);
    expect(await core.getApplication("denied")).toBeNull();
    expect(order).toEqual([
      "first:application.create",
      "second:application.create",
      "first:application.create",
      "second:application.create",
    ]);
  });

  it("after hooks fire post-commit and their errors are isolated", async () => {
    const seen: string[] = [];
    const reported: unknown[] = [];
    const { core } = setupWebhooks({
      hooks: [
        {
          after: (e) => {
            seen.push(e.type);
            throw new Error("side effect exploded");
          },
        },
        {
          after: (e) => {
            seen.push(`ok:${e.type}`);
          },
        },
      ],
      onHookError: (error) => {
        reported.push(error);
      },
    });
    const app = await core.createApplication({ key: "acme" });
    expect(app).toBeDefined();
    expect(seen).toContain("application.created");
    expect(seen).toContain("ok:application.created");
    expect(reported.length).toBe(1);
  });
});
