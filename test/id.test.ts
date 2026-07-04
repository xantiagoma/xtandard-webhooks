import { describe, expect, it } from "vitest";
import { idPattern, newId } from "../src/id.ts";

describe("newId", () => {
  it("generates prefixed 22-char base62 ids", () => {
    for (const prefix of ["msg", "ep", "dlv", "atp"] as const) {
      const id = newId(prefix);
      expect(id).toMatch(idPattern(prefix));
      expect(id.length).toBe(prefix.length + 1 + 22);
    }
  });

  it("generates unique ids", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(newId("msg"));
    expect(seen.size).toBe(1000);
  });

  it("idPattern rejects other prefixes and lengths", () => {
    expect(idPattern("msg").test(newId("ep"))).toBe(false);
    expect(idPattern("msg").test("msg_short")).toBe(false);
    expect(idPattern("msg").test(`msg_${"!".repeat(22)}`)).toBe(false);
  });
});
