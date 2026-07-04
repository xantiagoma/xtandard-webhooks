import { defineConfig, devices } from "@playwright/test";

const PORT = 3311;

/**
 * Browser e2e for the bundled admin UI. Builds the UI bundle, then boots the
 * in-memory e2e server (panel + dispatcher + in-process test receiver — see
 * e2e/server.ts) and drives the real SPA.
 *
 *   bun run test:e2e
 */
export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `bun run build:ui && PORT=${PORT} bun e2e/server.ts`,
    url: `http://localhost:${PORT}/healthcheck`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
