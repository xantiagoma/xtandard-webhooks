import { describe, expect, test } from "vitest";
import type { Principal } from "../src/auth/contract.ts";
import type {
  AuthorizeInput,
  WebhooksAction,
  WebhooksResource,
} from "../src/authorization/contract.ts";
import { isMutatingAction, MUTATING_ACTIONS } from "../src/authorization/contract.ts";
import { delegatedAuthorization } from "../src/authorization/delegated.ts";
import { noAuthorization } from "../src/authorization/none.ts";
import {
  ALL_ACTIONS,
  DEFAULT_ROLE_POLICY,
  READ_ACTIONS,
  rolesAuthorization,
} from "../src/authorization/roles.ts";

const RESOURCE: WebhooksResource = { type: "application", applicationKey: "acme" };

const input = (principal: Principal | null, action: WebhooksAction): AuthorizeInput => ({
  principal,
  action,
  resource: RESOURCE,
  request: new Request("http://x/"),
});

const admin: Principal = { id: "a", roles: ["admin"] };
const viewer: Principal = { id: "v", roles: ["viewer"] };
const editor: Principal = { id: "e", roles: ["editor"] };

describe("rolesAuthorization (default policy)", () => {
  const authz = rolesAuthorization();

  test("admin is allowed everything", async () => {
    for (const action of ALL_ACTIONS) {
      expect(await authz.authorize(input(admin, action))).toBe(true);
    }
  });

  test("viewer is allowed reads", async () => {
    for (const action of READ_ACTIONS) {
      expect(await authz.authorize(input(viewer, action))).toBe(true);
    }
  });

  test("viewer is denied writes", async () => {
    expect(await authz.authorize(input(viewer, "endpoint:update"))).toBe(false);
    expect(await authz.authorize(input(viewer, "application:create"))).toBe(false);
    expect(await authz.authorize(input(viewer, "message:publish"))).toBe(false);
    expect(await authz.authorize(input(viewer, "delivery:retry"))).toBe(false);
  });

  test("viewer is denied endpoint:read-secret (sensitive, not a plain read)", async () => {
    expect(READ_ACTIONS).not.toContain("endpoint:read-secret");
    expect(await authz.authorize(input(viewer, "endpoint:read-secret"))).toBe(false);
  });

  test("editor is allowed writes and secret reads", async () => {
    expect(await authz.authorize(input(editor, "endpoint:update"))).toBe(true);
    expect(await authz.authorize(input(editor, "message:publish"))).toBe(true);
    expect(await authz.authorize(input(editor, "endpoint:read-secret"))).toBe(true);
  });

  test("null principal is denied", async () => {
    expect(await authz.authorize(input(null, "endpoint:read"))).toBe(false);
  });

  test("principal with no matching role is denied", async () => {
    expect(await authz.authorize(input({ id: "x", roles: ["nobody"] }, "endpoint:read"))).toBe(
      false,
    );
    expect(await authz.authorize(input({ id: "x" }, "endpoint:read"))).toBe(false);
  });
});

describe("rolesAuthorization (readonly)", () => {
  const authz = rolesAuthorization({ readonly: true });

  test("blocks mutating actions even for admin", async () => {
    expect(await authz.authorize(input(admin, "endpoint:update"))).toBe(false);
    expect(await authz.authorize(input(admin, "message:publish"))).toBe(false);
    expect(await authz.authorize(input(admin, "endpoint:rotate-secret"))).toBe(false);
  });

  test("still allows reads for authorized roles", async () => {
    expect(await authz.authorize(input(admin, "endpoint:read"))).toBe(true);
    expect(await authz.authorize(input(viewer, "audit:read"))).toBe(true);
    // read-secret does not mutate — readonly leaves it to the role policy.
    expect(await authz.authorize(input(admin, "endpoint:read-secret"))).toBe(true);
  });
});

describe("rolesAuthorization (custom policy)", () => {
  test("honors an explicit action list", async () => {
    const authz = rolesAuthorization({
      policy: { ops: ["delivery:retry", "delivery:read"] },
    });
    const ops: Principal = { id: "o", roles: ["ops"] };
    expect(await authz.authorize(input(ops, "delivery:retry"))).toBe(true);
    expect(await authz.authorize(input(ops, "endpoint:update"))).toBe(false);
  });

  test("DEFAULT_ROLE_POLICY exposes admin/editor/viewer", () => {
    expect(DEFAULT_ROLE_POLICY.admin).toBe("*");
    expect(DEFAULT_ROLE_POLICY.editor).toEqual([...ALL_ACTIONS]);
    expect(DEFAULT_ROLE_POLICY.viewer).toEqual([...READ_ACTIONS]);
  });
});

describe("MUTATING_ACTIONS", () => {
  test("classifies reads as non-mutating and writes as mutating", () => {
    expect(isMutatingAction("endpoint:read")).toBe(false);
    expect(isMutatingAction("endpoint:read-secret")).toBe(false);
    expect(isMutatingAction("audit:read")).toBe(false);
    expect(isMutatingAction("endpoint:rotate-secret")).toBe(true);
    expect(isMutatingAction("message:publish")).toBe(true);
    expect(isMutatingAction("delivery:retry")).toBe(true);
    for (const action of MUTATING_ACTIONS) {
      expect(ALL_ACTIONS).toContain(action);
    }
  });
});

describe("noAuthorization", () => {
  test("allows everything, even for a null principal", async () => {
    const authz = noAuthorization();
    expect(await authz.authorize(input(null, "application:delete"))).toBe(true);
  });
});

describe("delegatedAuthorization", () => {
  test("allows when the delegate returns true", async () => {
    const authz = delegatedAuthorization({ authorize: () => true });
    expect(await authz.authorize(input(null, "endpoint:update"))).toBe(true);
  });

  test("denies when the delegate returns false", async () => {
    const authz = delegatedAuthorization({ authorize: () => false });
    expect(await authz.authorize(input(admin, "endpoint:read"))).toBe(false);
  });

  test("normalizes an async delegate and receives the input", async () => {
    const authz = delegatedAuthorization({
      authorize: async ({ action }) => action === "endpoint:read",
    });
    expect(await authz.authorize(input(admin, "endpoint:read"))).toBe(true);
    expect(await authz.authorize(input(admin, "endpoint:update"))).toBe(false);
  });
});
