/**
 * Run a bundled example with a free port (no collisions if you run several).
 *
 *   bun run examples:elysia      # or: hono | express | full-loop | …
 *
 * Server examples get a free PORT picked via get-port-please; script examples
 * (no server) just run. Each example is installed (`bun install`) on first use.
 * Examples link the package via `file:../..`, so build the repo once first:
 * `bun run build`.
 *
 * @module
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { getPort } from "get-port-please";

interface ExampleConfig {
  dir: string;
  kind: "server" | "script";
  /** Command to run (in the example dir). */
  run: string[];
  /** Optional pre-step (e.g. seed) run once before `run`. */
  seed?: string[];
  /** Preferred port for server examples; a nearby free one is used if taken. */
  preferredPort?: number;
  /** Path the admin panel is mounted at, for the printed URL. */
  panelPath?: string;
  /** External requirement to surface before running. */
  note?: string;
}

const EXAMPLES: Record<string, ExampleConfig> = {
  elysia: {
    dir: "examples/elysia",
    kind: "server",
    run: ["bun", "run", "start"],
    preferredPort: 3000,
    panelPath: "/webhooks",
  },
  hono: {
    dir: "examples/hono",
    kind: "server",
    run: ["bun", "run", "start"],
    preferredPort: 3000,
    panelPath: "/webhooks",
  },
  express: {
    dir: "examples/express",
    kind: "server",
    run: ["bun", "run", "start"],
    preferredPort: 3000,
    panelPath: "/webhooks",
  },
  "full-loop": {
    dir: "examples/full-loop",
    kind: "script",
    run: ["bun", "run", "start"],
    note: "sender + verifying receiver in one process — the receiver fails the first 2 attempts so you watch retries live",
  },
  auth: {
    dir: "examples/auth",
    kind: "server",
    run: ["bun", "run", "start"],
    preferredPort: 3000,
    note: "auth/authz flexibility demo — set AUTH_DEMO=none|basic|delegated|rbac (portal-token mint route on every mode)",
  },
  "storage-drivers": {
    dir: "examples/storage-drivers",
    kind: "script",
    run: ["bun", "run", "start"],
    note: "memory + file always run; set REDIS_URL / DATABASE_URL / MONGO_URL to include those backends",
  },
  "split-worker": {
    dir: "examples/split-worker",
    kind: "server",
    run: ["bun", "run", "start"],
    preferredPort: 3000,
    panelPath: "/webhooks",
    note: "boots BOTH processes: the web app (publishes only) and the delivery worker",
  },
  "portal-embed": {
    dir: "examples/portal-embed",
    kind: "server",
    run: ["bun", "run", "start"],
    preferredPort: 5190,
    note: "embedded <WebhooksPortal/> in a host app (vite) — boots a seeded panel on :3701 + mints a portal token",
  },
};

const name = process.argv[2];
const cfg = name ? EXAMPLES[name] : undefined;
if (!cfg) {
  console.error(`Unknown example "${name ?? ""}". Available: ${Object.keys(EXAMPLES).join(", ")}`);
  process.exit(1);
}

if (!existsSync("dist")) {
  console.error("dist/ is missing — build the package first: bun run build");
  process.exit(1);
}

async function sh(cmd: string[], cwd: string, env?: Record<string, string>): Promise<number> {
  const proc = Bun.spawn(cmd, {
    cwd,
    env: { ...process.env, ...env },
    stdout: "inherit",
    stderr: "inherit",
  });
  const cleanup = () => proc.kill();
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  return proc.exited;
}

if (cfg.note) console.log(`i  ${name}: ${cfg.note}`);

// Install on first use (examples link the package via file:../..).
if (!existsSync(join(cfg.dir, "node_modules"))) {
  console.log(`Installing ${name} dependencies …`);
  const code = await sh(["bun", "install"], cfg.dir);
  if (code !== 0) process.exit(code);
}

if (cfg.seed) {
  const code = await sh(cfg.seed, cfg.dir);
  if (code !== 0) process.exit(code);
}

const env: Record<string, string> = {};
if (cfg.kind === "server") {
  const preferred = cfg.preferredPort ?? 3000;
  const port = await getPort({ port: preferred, portRange: [preferred, preferred + 200] });
  env.PORT = String(port);
  console.log(`>  ${name} → http://localhost:${port}${cfg.panelPath ?? ""}`);
}

process.exit(await sh(cfg.run, cfg.dir, env));
