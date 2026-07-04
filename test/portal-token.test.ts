import { describe, expect, test } from "vitest";
import {
  createPortalToken,
  PORTAL_TOKEN_PREFIX,
  PortalTokenError,
  verifyPortalToken,
} from "../src/portal.ts";

const SECRET = "an-arbitrary-portal-secret";

const b64url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** Craft a correctly signed token over an arbitrary payload string. */
async function craftToken(secret: string, payload: string): Promise<string> {
  const payloadPart = b64url(new TextEncoder().encode(payload));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadPart)),
  );
  return `${PORTAL_TOKEN_PREFIX}${payloadPart}.${b64url(digest)}`;
}

describe("createPortalToken / verifyPortalToken", () => {
  test("round-trips the application key", async () => {
    const token = await createPortalToken(SECRET, "acme");
    expect(token.startsWith("whpt_")).toBe(true);
    expect(await verifyPortalToken(SECRET, token)).toEqual({ applicationKey: "acme" });
  });

  test("defaults expiry to 7 days", async () => {
    const before = Date.now();
    const token = await createPortalToken(SECRET, "acme");
    const payloadPart = token.slice(PORTAL_TOKEN_PREFIX.length).split(".")[0]!;
    const padded = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(padded + "=".repeat((4 - (padded.length % 4)) % 4)));
    const sevenDays = 7 * 86_400_000;
    expect(claims.app).toBe("acme");
    expect(claims.exp).toBeGreaterThanOrEqual(before + sevenDays);
    expect(claims.exp).toBeLessThanOrEqual(Date.now() + sevenDays);
  });

  test("honors a custom expiresIn duration", async () => {
    const before = Date.now();
    const token = await createPortalToken(SECRET, "acme", { expiresIn: "1h" });
    const payloadPart = token.slice(PORTAL_TOKEN_PREFIX.length).split(".")[0]!;
    const padded = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(padded + "=".repeat((4 - (padded.length % 4)) % 4)));
    expect(claims.exp).toBeGreaterThanOrEqual(before + 3_600_000);
    expect(claims.exp).toBeLessThanOrEqual(Date.now() + 3_600_000);
  });

  test("an expired token is rejected", async () => {
    const token = await createPortalToken(SECRET, "acme", { expiresIn: 0 });
    await expect(verifyPortalToken(SECRET, token)).rejects.toThrow(/expired/);
    await expect(verifyPortalToken(SECRET, token)).rejects.toBeInstanceOf(PortalTokenError);
  });

  test("a tampered signature is rejected", async () => {
    const token = await createPortalToken(SECRET, "acme");
    const flipped = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    await expect(verifyPortalToken(SECRET, flipped)).rejects.toThrow(/signature/);
  });

  test("a tampered payload is rejected (signature no longer matches)", async () => {
    const token = await createPortalToken(SECRET, "acme");
    const [payloadPart, signaturePart] = token.slice(PORTAL_TOKEN_PREFIX.length).split(".") as [
      string,
      string,
    ];
    const otherPayload = b64url(
      new TextEncoder().encode(JSON.stringify({ app: "other", exp: Date.now() + 60_000 })),
    );
    const forged = `${PORTAL_TOKEN_PREFIX}${otherPayload}.${signaturePart}`;
    expect(otherPayload).not.toBe(payloadPart);
    await expect(verifyPortalToken(SECRET, forged)).rejects.toThrow(/signature/);
  });

  test("a token minted with a different secret is rejected", async () => {
    const token = await createPortalToken("another-secret", "acme");
    await expect(verifyPortalToken(SECRET, token)).rejects.toThrow(/signature/);
  });

  test.each([
    ["missing prefix", "not-a-token"],
    ["wrong prefix", "whsec_abc.def"],
    ["no separator", "whpt_justonepart"],
    ["too many separators", "whpt_a.b.c"],
    ["empty payload", "whpt_.abc"],
    ["empty signature", "whpt_abc."],
    ["invalid base64url signature", "whpt_abc.###"],
  ])("malformed token (%s) is rejected", async (_label, token) => {
    await expect(verifyPortalToken(SECRET, token)).rejects.toBeInstanceOf(PortalTokenError);
  });

  test("a correctly signed token with a non-JSON payload is rejected", async () => {
    const token = await craftToken(SECRET, "not json at all");
    await expect(verifyPortalToken(SECRET, token)).rejects.toThrow(/payload/);
  });

  test("a correctly signed token missing claims is rejected", async () => {
    const noApp = await craftToken(SECRET, JSON.stringify({ exp: Date.now() + 60_000 }));
    await expect(verifyPortalToken(SECRET, noApp)).rejects.toThrow(/application/);

    const noExp = await craftToken(SECRET, JSON.stringify({ app: "acme" }));
    await expect(verifyPortalToken(SECRET, noExp)).rejects.toThrow(/expiry/);
  });

  test("a manually crafted token with a past exp is rejected", async () => {
    const token = await craftToken(SECRET, JSON.stringify({ app: "acme", exp: Date.now() - 1 }));
    await expect(verifyPortalToken(SECRET, token)).rejects.toThrow(/expired/);
  });

  test("tokens are strict base64url (no +, /, or padding)", async () => {
    // Keys chosen so plain base64 of the JSON payload would contain + or /.
    const keys = ["acme", "a~~~b", "app.with.dots", "x".repeat(70), "émoji-ø"];
    for (const app of keys) {
      const token = await createPortalToken(SECRET, app);
      expect(token).toMatch(/^whpt_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      expect(await verifyPortalToken(SECRET, token)).toEqual({ applicationKey: app });
    }
  });

  test("PortalTokenError sets its name for cross-bundle detection", () => {
    expect(new PortalTokenError("nope").name).toBe("PortalTokenError");
  });
});
