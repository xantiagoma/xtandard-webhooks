/**
 * A minimal host app for the React-embed e2e (see e2e/embed.spec.ts), bundled
 * on demand by e2e/server.ts. Mounts the **built** embed (`dist/react.js` +
 * the scoped `dist/react.css`) — the artifact consumers install — not the
 * sources.
 *
 * Query params: `theme` → the `theme` prop (`auto | inherit | light | dark`).
 * The host theme itself is set by the page markup / the test (a `dark` class or
 * `data-theme` on `<html>`), mimicking class- and attribute-based switchers.
 *
 * @module
 */

import React from "react";
import { createRoot } from "react-dom/client";
// @ts-expect-error — built artifact (no sibling .d.ts at this path); typed via src/react.tsx.
import { WebhooksDashboard } from "../dist/react.js";
import type { EmbedTheme } from "../src/react.tsx";

const theme = (new URLSearchParams(location.search).get("theme") ?? "inherit") as EmbedTheme;

createRoot(document.getElementById("host-root")!).render(
  <main>
    <h2 className="host-heading">Host app</h2>
    <WebhooksDashboard apiBaseUrl={location.origin} routing="memory" theme={theme} />
  </main>,
);
