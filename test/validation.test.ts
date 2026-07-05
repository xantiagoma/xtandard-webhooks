import { describe, expect, it } from "vitest";
import {
  assertValid,
  validateApplication,
  validateEndpoint,
  validateEndpointUrl,
  validateEventType,
  validateKeySegment,
  ValidationError,
} from "../src/validation.ts";

describe("validateKeySegment", () => {
  it("accepts safe segments", () => {
    expect(validateKeySegment("order-42", "k")).toEqual([]);
    expect(validateKeySegment("a.b_c-1", "k")).toEqual([]);
  });

  it("rejects slashes and path separators", () => {
    expect(validateKeySegment("x/metadata", "k")).not.toEqual([]);
    expect(validateKeySegment("../escape", "k")).not.toEqual([]);
    expect(validateKeySegment("a b", "k")).not.toEqual([]);
  });

  it("rejects dot-only segments", () => {
    expect(validateKeySegment(".", "k")[0]?.message).toContain("not an allowed key");
    expect(validateKeySegment("..", "k")[0]?.message).toContain("not an allowed key");
    expect(validateKeySegment("...", "k")).not.toEqual([]);
  });

  it("rejects over-long segments", () => {
    const issues = validateKeySegment("a".repeat(257), "k");
    expect(issues[0]?.message).toContain("at most 256");
  });
});

describe("validateApplication", () => {
  it("accepts a minimal application", () => {
    expect(validateApplication({ key: "acme" }).valid).toBe(true);
    expect(
      validateApplication({ key: "acme-corp.v2", name: "Acme", metadata: { plan: "pro" } }).valid,
    ).toBe(true);
  });

  it("rejects bad keys", () => {
    expect(validateApplication({ key: "" }).valid).toBe(false);
    expect(validateApplication({ key: "has space" }).valid).toBe(false);
    expect(validateApplication({ key: "has/slash" }).valid).toBe(false);
    expect(validateApplication({}).valid).toBe(false);
  });

  it("rejects reserved keys that collide with global index keys", () => {
    for (const key of ["applications", "event-types"]) {
      const result = validateApplication({ key });
      expect(result.valid).toBe(false);
      expect(result.errors[0]?.message).toContain("reserved");
    }
  });
});

describe("validateEventType", () => {
  it("accepts dot-delimited names and optional JSON schema", () => {
    expect(validateEventType({ name: "invoice.paid" }).valid).toBe(true);
    expect(
      validateEventType({
        name: "user.created",
        description: "A user signed up",
        groupName: "Users",
        schema: { type: "object" },
        deprecated: false,
      }).valid,
    ).toBe(true);
  });

  it("rejects invalid names", () => {
    expect(validateEventType({ name: "no spaces" }).valid).toBe(false);
    expect(validateEventType({ name: "" }).valid).toBe(false);
  });
});

describe("validateEndpointUrl", () => {
  it("accepts https anywhere and http on localhost", () => {
    expect(validateEndpointUrl("https://api.example.com/hooks").valid).toBe(true);
    expect(validateEndpointUrl("http://localhost:3000/hooks").valid).toBe(true);
    expect(validateEndpointUrl("http://127.0.0.1/hooks").valid).toBe(true);
  });

  it("rejects http for non-localhost unless allowInsecureUrls", () => {
    expect(validateEndpointUrl("http://api.example.com/hooks").valid).toBe(false);
    expect(
      validateEndpointUrl("http://api.example.com/hooks", { allowInsecureUrls: true }).valid,
    ).toBe(true);
  });

  it("rejects credentials, unparseable URLs, and odd protocols", () => {
    expect(validateEndpointUrl("https://user:pass@example.com/").valid).toBe(false);
    expect(validateEndpointUrl("not a url").valid).toBe(false);
    expect(validateEndpointUrl("ftp://example.com/").valid).toBe(false);
  });

  it("consults the host urlPolicy gate", () => {
    const options = { urlPolicy: (url: string) => !url.includes("10.0.0.1") };
    expect(validateEndpointUrl("https://10.0.0.1/hooks", options).valid).toBe(false);
    expect(validateEndpointUrl("https://api.example.com/hooks", options).valid).toBe(true);
  });
});

describe("validateEndpoint", () => {
  it("accepts a minimal endpoint", () => {
    expect(validateEndpoint({ url: "https://api.example.com/hooks" }).valid).toBe(true);
  });

  it("accepts subscriptions and custom headers", () => {
    expect(
      validateEndpoint({
        url: "https://api.example.com/hooks",
        eventTypes: ["invoice.paid", "user.created"],
        headers: { "x-tenant": "acme" },
        metadata: { region: "eu" },
      }).valid,
    ).toBe(true);
  });

  it("rejects reserved Standard Webhooks headers (case-insensitive)", () => {
    for (const header of ["webhook-id", "Webhook-Signature", "WEBHOOK-TIMESTAMP"]) {
      const result = validateEndpoint({
        url: "https://api.example.com/hooks",
        headers: { [header]: "x" },
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]?.message).toContain("reserved");
    }
  });

  it("rejects invalid event type names in subscriptions", () => {
    expect(
      validateEndpoint({ url: "https://api.example.com/hooks", eventTypes: ["bad name"] }).valid,
    ).toBe(false);
  });

  it("propagates URL policy failures", () => {
    expect(validateEndpoint({ url: "http://api.example.com/hooks" }).valid).toBe(false);
  });
});

describe("assertValid", () => {
  it("throws ValidationError with the issue list", () => {
    const result = validateApplication({ key: "bad key" });
    expect(() => assertValid(result)).toThrow(ValidationError);
    try {
      assertValid(result);
    } catch (err) {
      expect((err as ValidationError).name).toBe("ValidationError");
      expect((err as ValidationError).errors.length).toBeGreaterThan(0);
    }
  });

  it("passes valid results through", () => {
    expect(() => assertValid(validateApplication({ key: "acme" }))).not.toThrow();
  });
});
