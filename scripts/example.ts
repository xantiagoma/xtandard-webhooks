/**
 * Run a bundled example with a free port (no collisions if you run several).
 *
 *   bun run examples:elysia      # or: hono | express | full-loop | …
 *
 * Server examples get a free PORT near their preferred one; script examples (no
 * server) just run. Each example is installed (`bun install`) on first use. The
 * runner is `@xtandard/kit/build`'s `createExampleRunner`.
 * Examples link the package via `file:../..`, so build the repo once first:
 * `bun run build`.
 *
 * @module
 */

import { existsSync } from "node:fs";
import { createExampleRunner, type ExampleConfig } from "@xtandard/kit/build";

export const EXAMPLES: Record<string, ExampleConfig> = {
  elysia: {
    dir: "examples/elysia",
    kind: "server",
    install: "always",
    run: ["bun", "run", "start"],
    preferredPort: 3000,
    panelPath: "/webhooks",
  },
  hono: {
    dir: "examples/hono",
    kind: "server",
    install: "always",
    run: ["bun", "run", "start"],
    preferredPort: 3000,
    panelPath: "/webhooks",
  },
  express: {
    dir: "examples/express",
    kind: "server",
    install: "always",
    run: ["bun", "run", "start"],
    preferredPort: 3000,
    panelPath: "/webhooks",
  },
  "full-loop": {
    dir: "examples/full-loop",
    kind: "script",
    install: "always",
    run: ["bun", "run", "start"],
    note: "sender + verifying receiver in one process — the receiver fails the first 2 attempts so you watch retries live",
  },
  auth: {
    dir: "examples/auth",
    kind: "server",
    install: "always",
    run: ["bun", "run", "start"],
    preferredPort: 3000,
    note: "auth/authz flexibility demo — set AUTH_DEMO=none|basic|delegated|rbac (portal-token mint route on every mode)",
  },
  "storage-drivers": {
    dir: "examples/storage-drivers",
    kind: "script",
    install: "always",
    run: ["bun", "run", "start"],
    note: "memory + file always run; set REDIS_URL / DATABASE_URL / MONGO_URL to include those backends",
  },
  "split-worker": {
    dir: "examples/split-worker",
    kind: "server",
    install: "always",
    run: ["bun", "run", "start"],
    preferredPort: 3000,
    panelPath: "/webhooks",
    note: "boots BOTH processes: the web app (publishes only) and the delivery worker",
  },
  "portal-embed": {
    dir: "examples/portal-embed",
    kind: "server",
    install: "always",
    run: ["bun", "run", "start"],
    preferredPort: 5190,
    note: "embedded <WebhooksPortal/> in a host app (vite) — boots a seeded panel on :3701 + mints a portal token",
  },
};

if (import.meta.main) {
  // Examples link the package via file:../.., so it must be built first.
  if (!existsSync("dist")) {
    console.error("dist/ is missing — build the package first: bun run build");
    process.exit(1);
  }
  process.exit(await createExampleRunner(EXAMPLES).main(process.argv.slice(2)));
}
