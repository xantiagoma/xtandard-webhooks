import { describe, expect, test } from "vitest";
import { basicAuth } from "../src/auth/basic.ts";

describe("basicAuth (webhooks defaults)", () => {
  test("challenge() defaults the realm to xtandard-webhooks", () => {
    const auth = basicAuth({ users: [{ username: "admin", password: "secret" }] });
    const response = auth.challenge?.(new Request("http://x/"));
    expect(response?.status).toBe(401);
    expect(response?.headers.get("WWW-Authenticate")).toBe('Basic realm="xtandard-webhooks"');
  });

  test("an explicit realm wins", () => {
    const auth = basicAuth({
      users: [{ username: "admin", password: "secret" }],
      realm: "Webhooks Admin",
    });
    const response = auth.challenge?.(new Request("http://x/"));
    expect(response?.headers.get("WWW-Authenticate")).toBe('Basic realm="Webhooks Admin"');
  });
});
