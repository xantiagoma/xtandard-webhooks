import { describe, expect, it } from "vitest";
import { verifyWebhook, WebhookVerificationError } from "../src/receiver.ts";
import { generateSecret, signatureHeader } from "../src/signing.ts";

async function signedRequest(
  secrets: string[],
  body: string,
  overrides: Record<string, string> = {},
): Promise<Request> {
  const timestamp = Math.floor(Date.now() / 1000);
  const headers = {
    "content-type": "application/json",
    "webhook-id": "msg_test",
    "webhook-timestamp": String(timestamp),
    "webhook-signature": await signatureHeader(secrets, "msg_test", timestamp, body),
    ...overrides,
  };
  return new Request("https://receiver.example.com/hooks", {
    method: "POST",
    headers,
    body,
  });
}

describe("verifyWebhook", () => {
  it("verifies a signed Request and returns the parsed envelope", async () => {
    const secret = generateSecret();
    const body = JSON.stringify({
      type: "invoice.paid",
      timestamp: "2026-07-04T12:00:00.000Z",
      data: { invoiceId: "inv_1", amount: 4200 },
    });
    const envelope = await verifyWebhook(await signedRequest([secret], body), secret);
    expect(envelope.type).toBe("invoice.paid");
    expect(envelope.data).toEqual({ invoiceId: "inv_1", amount: 4200 });
  });

  it("verifies during rotation when either secret is provided", async () => {
    const oldSecret = generateSecret();
    const newSecret = generateSecret();
    const body = JSON.stringify({ type: "t", timestamp: "now", data: null });
    // Sender signs with both (rotation grace); receiver still only knows the old one.
    const request = await signedRequest([newSecret, oldSecret], body);
    await expect(verifyWebhook(request.clone(), oldSecret)).resolves.toBeDefined();
    await expect(verifyWebhook(request, [oldSecret, newSecret])).resolves.toBeDefined();
  });

  it("rejects a tampered Request", async () => {
    const secret = generateSecret();
    const body = JSON.stringify({ type: "t", timestamp: "now", data: 1 });
    const request = await signedRequest([secret], body);
    const tampered = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify({ type: "t", timestamp: "now", data: 2 }),
    });
    await expect(verifyWebhook(tampered, secret)).rejects.toThrow(WebhookVerificationError);
  });

  it("honors toleranceSeconds/now options", async () => {
    const secret = generateSecret();
    const body = JSON.stringify({ type: "t", timestamp: "now", data: null });
    const request = await signedRequest([secret], body);
    await expect(
      verifyWebhook(request, secret, { now: Math.floor(Date.now() / 1000) + 10_000 }),
    ).rejects.toThrow("too old");
  });
});
