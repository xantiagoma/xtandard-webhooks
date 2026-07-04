import { describe, expect, it } from "vitest";
import {
  generateSecret,
  sign,
  signatureHeader,
  verify,
  WebhookVerificationError,
} from "../src/signing.ts";

// The Standard Webhooks spec's own reference vector — a permanent known-answer
// test. If this breaks, we are no longer wire-compatible with the ecosystem.
const VECTOR = {
  id: "msg_p5jXN8AQM9LWM0D4loKWxJek",
  timestamp: 1614265330,
  body: '{"test": 2432232314}',
  secret: "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
  signature: "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
};

const vectorHeaders = (signature = VECTOR.signature) => ({
  "webhook-id": VECTOR.id,
  "webhook-timestamp": String(VECTOR.timestamp),
  "webhook-signature": signature,
});

describe("sign", () => {
  it("reproduces the spec reference vector", async () => {
    await expect(sign(VECTOR.secret, VECTOR.id, VECTOR.timestamp, VECTOR.body)).resolves.toBe(
      VECTOR.signature,
    );
  });

  it("rejects secrets with out-of-range key material", async () => {
    const tooShort = `whsec_${btoa("short")}`;
    await expect(sign(tooShort, "id", 1, "{}")).rejects.toThrow(WebhookVerificationError);
    const tooLong = `whsec_${btoa("x".repeat(65))}`;
    await expect(sign(tooLong, "id", 1, "{}")).rejects.toThrow("outside");
    await expect(sign("whsec_!!!not-base64!!!", "id", 1, "{}")).rejects.toThrow("not base64");
  });
});

describe("generateSecret", () => {
  it("produces verifiable whsec_ secrets of 24 bytes", async () => {
    const secret = generateSecret();
    expect(secret.startsWith("whsec_")).toBe(true);
    expect(atob(secret.slice("whsec_".length)).length).toBe(24);
    const signature = await sign(secret, "msg_1", 1720000000, '{"a":1}');
    expect(signature.startsWith("v1,")).toBe(true);
  });

  it("is random", () => {
    expect(generateSecret()).not.toBe(generateSecret());
  });
});

describe("signatureHeader", () => {
  it("joins one signature per secret with spaces (rotation)", async () => {
    const other = generateSecret();
    const header = await signatureHeader(
      [VECTOR.secret, other],
      VECTOR.id,
      VECTOR.timestamp,
      VECTOR.body,
    );
    const parts = header.split(" ");
    expect(parts.length).toBe(2);
    expect(parts[0]).toBe(VECTOR.signature);
    expect(parts[1]).toMatch(/^v1,/);
  });
});

describe("verify", () => {
  it("verifies the spec reference vector", async () => {
    const envelope = await verify({
      payload: VECTOR.body,
      headers: vectorHeaders(),
      secret: VECTOR.secret,
      now: VECTOR.timestamp,
    });
    expect(envelope).toEqual({ test: 2432232314 });
  });

  it("looks headers up case-insensitively", async () => {
    await expect(
      verify({
        payload: VECTOR.body,
        headers: {
          "Webhook-Id": VECTOR.id,
          "WEBHOOK-TIMESTAMP": String(VECTOR.timestamp),
          "Webhook-Signature": VECTOR.signature,
        },
        secret: VECTOR.secret,
        now: VECTOR.timestamp,
      }),
    ).resolves.toEqual({ test: 2432232314 });
  });

  it("accepts any matching secret among candidates (rotation)", async () => {
    await expect(
      verify({
        payload: VECTOR.body,
        headers: vectorHeaders(),
        secret: [generateSecret(), VECTOR.secret],
        now: VECTOR.timestamp,
      }),
    ).resolves.toEqual({ test: 2432232314 });
  });

  it("accepts any matching signature among space-separated entries", async () => {
    const otherSig = await sign(generateSecret(), VECTOR.id, VECTOR.timestamp, VECTOR.body);
    await expect(
      verify({
        payload: VECTOR.body,
        headers: vectorHeaders(`${otherSig} ${VECTOR.signature}`),
        secret: VECTOR.secret,
        now: VECTOR.timestamp,
      }),
    ).resolves.toEqual({ test: 2432232314 });
  });

  it("ignores non-v1 entries but fails when none are v1", async () => {
    await expect(
      verify({
        payload: VECTOR.body,
        headers: vectorHeaders(`v1a,AAAA ${VECTOR.signature}`),
        secret: VECTOR.secret,
        now: VECTOR.timestamp,
      }),
    ).resolves.toBeDefined();
    await expect(
      verify({
        payload: VECTOR.body,
        headers: vectorHeaders("v1a,AAAA"),
        secret: VECTOR.secret,
        now: VECTOR.timestamp,
      }),
    ).rejects.toThrow("No v1 signature");
  });

  it("rejects a tampered body", async () => {
    await expect(
      verify({
        payload: '{"test": 999}',
        headers: vectorHeaders(),
        secret: VECTOR.secret,
        now: VECTOR.timestamp,
      }),
    ).rejects.toThrow("No matching signature");
  });

  it("rejects the wrong secret", async () => {
    await expect(
      verify({
        payload: VECTOR.body,
        headers: vectorHeaders(),
        secret: generateSecret(),
        now: VECTOR.timestamp,
      }),
    ).rejects.toThrow(WebhookVerificationError);
  });

  it("rejects timestamps outside tolerance, both directions", async () => {
    await expect(
      verify({
        payload: VECTOR.body,
        headers: vectorHeaders(),
        secret: VECTOR.secret,
        now: VECTOR.timestamp + 301,
      }),
    ).rejects.toThrow("too old");
    await expect(
      verify({
        payload: VECTOR.body,
        headers: vectorHeaders(),
        secret: VECTOR.secret,
        now: VECTOR.timestamp - 301,
      }),
    ).rejects.toThrow("in the future");
    // Within a custom tolerance both pass.
    await expect(
      verify({
        payload: VECTOR.body,
        headers: vectorHeaders(),
        secret: VECTOR.secret,
        now: VECTOR.timestamp + 301,
        toleranceSeconds: 600,
      }),
    ).resolves.toBeDefined();
  });

  it("rejects missing or malformed headers", async () => {
    const base = {
      payload: VECTOR.body,
      secret: VECTOR.secret,
      now: VECTOR.timestamp,
    };
    const headers = vectorHeaders();
    for (const missing of ["webhook-id", "webhook-timestamp", "webhook-signature"]) {
      const partial = { ...headers } as Record<string, string>;
      delete partial[missing];
      await expect(verify({ ...base, headers: partial })).rejects.toThrow(`Missing ${missing}`);
    }
    await expect(
      verify({ ...base, headers: { ...headers, "webhook-timestamp": "not-a-number" } }),
    ).rejects.toThrow("Invalid webhook-timestamp");
  });

  it("rejects malformed base64 signature entries without matching", async () => {
    await expect(
      verify({
        payload: VECTOR.body,
        headers: vectorHeaders("v1,!!!!"),
        secret: VECTOR.secret,
        now: VECTOR.timestamp,
      }),
    ).rejects.toThrow("No matching signature");
  });

  it("rejects non-JSON payloads after a valid signature", async () => {
    const secret = generateSecret();
    const payload = "not json";
    const signature = await sign(secret, "msg_1", 1720000000, payload);
    await expect(
      verify({
        payload,
        headers: {
          "webhook-id": "msg_1",
          "webhook-timestamp": "1720000000",
          "webhook-signature": signature,
        },
        secret,
        now: 1720000000,
      }),
    ).rejects.toThrow("not valid JSON");
  });

  it("rejects an empty secret list", async () => {
    await expect(
      verify({
        payload: VECTOR.body,
        headers: vectorHeaders(),
        secret: [],
        now: VECTOR.timestamp,
      }),
    ).rejects.toThrow("No secret");
  });
});
