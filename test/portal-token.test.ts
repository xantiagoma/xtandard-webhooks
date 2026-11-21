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

  test("PortalTokenError sets its name for cross-bundle detection", async () => {
    expect(new PortalTokenError("nope").name).toBe("PortalTokenError");
    const error = await verifyPortalToken(SECRET, "whpt_x.y").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PortalTokenError);
  });

  test("a token signed by an earlier release (raw HMAC over { app, exp }) verifies", async () => {
    const token = await craftToken(
      SECRET,
      JSON.stringify({ app: "acme", exp: Date.now() + 60_000 }),
    );
    expect(await verifyPortalToken(SECRET, token)).toEqual({ applicationKey: "acme" });
  });

  test("an empty secret is rejected (fixed: it used to sign with an empty key)", async () => {
    await expect(createPortalToken("", "acme")).rejects.toThrow(PortalTokenError);
    const token = await createPortalToken(SECRET, "acme");
    await expect(verifyPortalToken("", token)).rejects.toThrow(/secret is required/);
  });

  test("secret rotation: the first secret signs, any listed secret verifies", async () => {
    const old = await createPortalToken("old-secret", "acme");
    const fresh = await createPortalToken(["new-secret", "old-secret"], "acme");
    for (const token of [old, fresh]) {
      expect(await verifyPortalToken(["new-secret", "old-secret"], token)).toEqual({
        applicationKey: "acme",
      });
    }
    await expect(verifyPortalToken("old-secret", fresh)).rejects.toThrow(/signature/);
  });
});
