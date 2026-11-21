import { definePlaywrightConfig } from "@xtandard/kit/build";

/**
 * Browser e2e for the bundled admin UI and the React embed. Builds the UI bundle
 * and the embed (dist/react.js + scoped react.css), then boots the
 * in-memory e2e server (panel + dispatcher + in-process test receiver — see
 * e2e/server.ts) and drives the real SPA.
 *
 *   bun run test:e2e
 */
export default definePlaywrightConfig({
  port: 3311,
  serverCmd: "bun run build:ui && bun run build:react && bun e2e/server.ts",
});
