import { describe, expect, it } from "vitest";
import {
  WebhooksDashboard,
  WebhooksPortal,
  setApiBase,
  setApiToken,
  type WebhooksDashboardProps,
  type WebhooksPortalProps,
} from "../src/react.tsx";

// Smoke test for the `@xtandard/webhooks/react` embed entry: the module must
// import cleanly outside a DOM and export both components. No rendering here —
// everything visual is covered by e2e (see docs/TESTING.md policy).
describe("react embed", () => {
  it("exports WebhooksDashboard and WebhooksPortal as components", () => {
    expect(typeof WebhooksDashboard).toBe("function");
    expect(typeof WebhooksPortal).toBe("function");
  });

  it("exports the API client setters", () => {
    expect(typeof setApiBase).toBe("function");
    expect(typeof setApiToken).toBe("function");
  });

  it("prop types compile", () => {
    // Type-level usage only (never rendered): the dashboard accepts the full
    // prop surface, the portal requires `token` and rejects the admin-only
    // `initialApplicationKey`.
    const dashboardProps: WebhooksDashboardProps = {
      apiBaseUrl: "/webhooks",
      credentials: "include",
      fetch: (input, init) => fetch(input, init),
      theme: "inherit",
      className: "embedded",
      routing: "memory",
      routerBase: "/admin/webhooks",
      logoUrl: "/logo.svg",
      initialApplicationKey: "acme",
    };

    const portalProps: WebhooksPortalProps = {
      apiBaseUrl: "/webhooks",
      token: "whpt_example",
    };

    const invalidPortalProps: WebhooksPortalProps = {
      token: "whpt_example",
      // @ts-expect-error — portal is pinned to the token's application.
      initialApplicationKey: "acme",
    };

    // Minimal usage: everything on the dashboard is optional; the portal only
    // needs its token.
    const minimalDashboardProps: WebhooksDashboardProps = {};

    expect(dashboardProps.apiBaseUrl).toBe("/webhooks");
    expect(portalProps.token).toBe("whpt_example");
    expect(invalidPortalProps.token).toBe("whpt_example");
    expect(minimalDashboardProps).toEqual({});
  });
});
