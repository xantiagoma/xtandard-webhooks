import { describe, expect, it } from "vitest";
import { delegatedAuth } from "../src/auth/delegated.ts";

describe("delegatedAuth", () => {
  it("forwards to the caller's authenticate (async principal)", async () => {
    const auth = delegatedAuth({
      authenticate: async (request) =>
        request.headers.get("authorization") === "Bearer good"
          ? { id: "u1", roles: ["admin"] }
          : null,
    });
    expect(
      await auth.authenticate(
        new Request("http://x", { headers: { authorization: "Bearer good" } }),
      ),
    ).toEqual({ id: "u1", roles: ["admin"] });
    expect(await auth.authenticate(new Request("http://x"))).toBeNull();
  });

  it("normalizes a synchronous resolver", async () => {
    const auth = delegatedAuth({ authenticate: () => ({ id: "sync" }) });
    expect(await auth.authenticate(new Request("http://x"))).toEqual({ id: "sync" });
  });

  it("forwards an optional challenge, and omits it when not given", () => {
    const withChallenge = delegatedAuth({
      authenticate: () => null,
      challenge: () => new Response("nope", { status: 401 }),
    });
    expect(withChallenge.challenge?.(new Request("http://x"))?.status).toBe(401);

    expect(delegatedAuth({ authenticate: () => null }).challenge).toBeUndefined();
  });
});
