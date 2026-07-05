import { describe, expect, it } from "vitest";
import { ANONYMOUS_PRINCIPAL, noAuth } from "../src/auth/none.ts";

describe("noAuth", () => {
  it("resolves every request to the shared anonymous principal", async () => {
    const auth = noAuth();
    const p = await auth.authenticate(new Request("http://x/api/applications"));
    expect(p).toEqual({ id: "anonymous" });
    expect(p).toBe(ANONYMOUS_PRINCIPAL);
    // Never null → always "authenticated"; authorization does the gating.
    expect(await auth.authenticate(new Request("http://x/other"))).not.toBeNull();
  });

  it("exposes no challenge (falls back to the server default)", () => {
    expect(noAuth().challenge).toBeUndefined();
  });
});
