import { describe, expect, test } from "vitest";
import { basicAuth, hashPassword, verifyPassword } from "../src/auth/basic.ts";

const basicHeader = (username: string, password: string): Request =>
  new Request("http://x/", {
    headers: { Authorization: "Basic " + btoa(`${username}:${password}`) },
  });

describe("hashPassword / verifyPassword", () => {
  test("round-trips a correct password", async () => {
    const stored = await hashPassword("secret");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("secret", stored)).toBe(true);
  });

  test("rejects a wrong password", async () => {
    const stored = await hashPassword("secret");
    expect(await verifyPassword("nope", stored)).toBe(false);
  });

  test("uses a random salt (digests differ for the same password)", async () => {
    const a = await hashPassword("secret");
    const b = await hashPassword("secret");
    expect(a).not.toBe(b);
  });

  test("returns false for malformed digests", async () => {
    expect(await verifyPassword("secret", "not-a-digest")).toBe(false);
    expect(await verifyPassword("secret", "bcrypt$aa$bb")).toBe(false);
    expect(await verifyPassword("secret", "scrypt$$")).toBe(false);
  });
});

describe("basicAuth", () => {
  test("authenticates with a hashed password and returns the principal", async () => {
    const auth = basicAuth({
      users: [
        {
          username: "admin",
          passwordHash: await hashPassword("secret"),
          roles: ["admin"],
          email: "admin@example.com",
        },
      ],
    });
    const principal = await auth.authenticate(basicHeader("admin", "secret"));
    expect(principal).toEqual({
      id: "admin",
      name: "admin",
      email: "admin@example.com",
      roles: ["admin"],
    });
  });

  test("uses a custom id when supplied", async () => {
    const auth = basicAuth({
      users: [{ username: "admin", id: "u-1", passwordHash: await hashPassword("secret") }],
    });
    const principal = await auth.authenticate(basicHeader("admin", "secret"));
    expect(principal?.id).toBe("u-1");
  });

  test("fails with a wrong password", async () => {
    const auth = basicAuth({
      users: [{ username: "admin", passwordHash: await hashPassword("secret") }],
    });
    expect(await auth.authenticate(basicHeader("admin", "wrong"))).toBeNull();
  });

  test("fails for an unknown user", async () => {
    const auth = basicAuth({
      users: [{ username: "admin", passwordHash: await hashPassword("secret") }],
    });
    expect(await auth.authenticate(basicHeader("ghost", "secret"))).toBeNull();
  });

  test("fails when no Authorization header is present", async () => {
    const auth = basicAuth({
      users: [{ username: "admin", passwordHash: await hashPassword("secret") }],
    });
    expect(await auth.authenticate(new Request("http://x/"))).toBeNull();
  });

  test("fails for a non-Basic scheme", async () => {
    const auth = basicAuth({ users: [{ username: "admin", password: "secret" }] });
    const request = new Request("http://x/", {
      headers: { Authorization: "Bearer token" },
    });
    expect(await auth.authenticate(request)).toBeNull();
  });

  test("supports dev-only plaintext passwords", async () => {
    const auth = basicAuth({ users: [{ username: "dev", password: "plain", roles: ["editor"] }] });
    const principal = await auth.authenticate(basicHeader("dev", "plain"));
    expect(principal?.id).toBe("dev");
    expect(principal?.roles).toEqual(["editor"]);
    expect(await auth.authenticate(basicHeader("dev", "wrong"))).toBeNull();
  });

  test("passwordVerifier mode delegates the decision", async () => {
    const auth = basicAuth({
      users: [{ username: "admin", roles: ["admin"] }],
      passwordVerifier: (username, password) => username === "admin" && password === "open",
    });
    expect(await auth.authenticate(basicHeader("admin", "open"))).toMatchObject({
      id: "admin",
      roles: ["admin"],
    });
    expect(await auth.authenticate(basicHeader("admin", "closed"))).toBeNull();
  });

  test("challenge() returns 401 with WWW-Authenticate", () => {
    const auth = basicAuth({
      users: [{ username: "admin", password: "secret" }],
      realm: "Webhooks Admin",
    });
    const response = auth.challenge?.(new Request("http://x/"));
    expect(response).toBeInstanceOf(Response);
    expect(response?.status).toBe(401);
    expect(response?.headers.get("WWW-Authenticate")).toBe('Basic realm="Webhooks Admin"');
  });

  test("challenge() defaults the realm", () => {
    const auth = basicAuth({ users: [{ username: "admin", password: "secret" }] });
    const response = auth.challenge?.(new Request("http://x/"));
    expect(response?.headers.get("WWW-Authenticate")).toBe('Basic realm="xtandard-webhooks"');
  });

  test("plaintext password of a different length fails (constant-time length guard)", async () => {
    const auth = basicAuth({ users: [{ username: "dev", password: "plain" }] });
    // Different length triggers the length-mismatch branch in constantTimeEquals.
    expect(await auth.authenticate(basicHeader("dev", "a-much-longer-password"))).toBeNull();
  });

  test("a header with no ':' separator yields null", async () => {
    const auth = basicAuth({ users: [{ username: "dev", password: "plain" }] });
    const request = new Request("http://x/", {
      headers: { Authorization: "Basic " + btoa("no-colon-here") },
    });
    expect(await auth.authenticate(request)).toBeNull();
  });

  test("a user with no credentials configured can never authenticate", async () => {
    const auth = basicAuth({ users: [{ username: "ghost" }] });
    expect(await auth.authenticate(basicHeader("ghost", "anything"))).toBeNull();
  });

  test("passwordVerifier runs a dummy check for unknown users (still null)", async () => {
    const calls: string[] = [];
    const auth = basicAuth({
      users: [{ username: "admin", roles: ["admin"] }],
      passwordVerifier: (username) => {
        calls.push(username);
        return true; // even if it would accept, an unknown user is rejected
      },
    });
    expect(await auth.authenticate(basicHeader("unknown-user", "pw"))).toBeNull();
    // The dummy verification was invoked to keep timing uniform.
    expect(calls).toContain("unknown-user");
  });
});
