import React from "react";
import { WebhooksPortal } from "@xtandard/webhooks/react";
import "@xtandard/webhooks/react/styles.css";

/** Where the panel API lives — a DIFFERENT origin than this host app. */
const PANEL_URL = "http://localhost:3701";

/**
 * A host SaaS app embedding the customer-scoped consumer portal on one of its
 * routes ("Developer Settings → Webhooks"). The flow:
 *
 * 1. The frontend asks ITS OWN backend for a portal token (`/portal-token`,
 *    proxied by Vite — in real life a session-guarded route that mints a token
 *    for the signed-in customer with `createPortalToken`).
 * 2. `<WebhooksPortal>` sends the token as a Bearer credential on every panel
 *    API request; the panel confines it to the token's application and flips
 *    into the reduced portal chrome (`/config` → `portal: true`).
 */
export function App(): React.ReactElement {
  const [token, setToken] = React.useState<string>();
  const [error, setError] = React.useState<string>();

  React.useEffect(() => {
    fetch("/portal-token", { method: "POST" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Token mint failed: HTTP ${res.status}`);
        const body = (await res.json()) as { token: string };
        setToken(body.token);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <div style={{ minHeight: "100vh" }}>
      <div
        style={{
          background: "#111827",
          color: "#fff",
          padding: "10px 20px",
          font: "600 14px system-ui",
          display: "flex",
          gap: 10,
          alignItems: "center",
        }}
      >
        <span style={{ opacity: 0.6 }}>Acme SaaS</span>
        <span style={{ opacity: 0.3 }}>/</span>
        <span style={{ opacity: 0.6 }}>Developer Settings</span>
        <span style={{ opacity: 0.3 }}>/</span>
        <span>Webhooks</span>
      </div>
      {error ? (
        <p style={{ font: "14px system-ui", padding: 20 }}>
          Could not mint a portal token ({error}) — is <code>start.ts</code> running?
        </p>
      ) : token ? (
        <WebhooksPortal apiBaseUrl={PANEL_URL} token={token} />
      ) : (
        <p style={{ font: "14px system-ui", padding: 20 }}>Minting a portal token…</p>
      )}
    </div>
  );
}
