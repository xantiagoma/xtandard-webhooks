/**
 * Integration test for the CLI `serve` and `dispatch` commands. Each boots in
 * a subprocess (so the never-resolving `run([...])` doesn't hang the test),
 * then the test probes the healthcheck and basic-auth enforcement. Spawned via
 * Bun, so it runs under `bun test` (not vitest).
 *
 *   bun test test/cli-serve.bun.test.ts
 */
import { afterAll, expect, test } from "bun:test";

const SERVE_PORT = 4413;
const DISPATCH_PORT = 4414;
const BASE = `http://localhost:${SERVE_PORT}`;

const serveProc = Bun.spawn(["bun", "-e", "import('./src/cli.ts').then((m) => m.run(['serve']))"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(SERVE_PORT),
    AUTH_MODE: "basic",
    AUTH_USERNAME: "admin",
    AUTH_PASSWORD: "secret",
    STORAGE_DRIVER: "memory",
    DISPATCHER: "0",
  },
  stdout: "pipe",
  stderr: "pipe",
});

const dispatchProc = Bun.spawn(
  ["bun", "-e", "import('./src/cli.ts').then((m) => m.run(['dispatch']))"],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(DISPATCH_PORT),
      STORAGE_DRIVER: "memory",
    },
    stdout: "pipe",
    stderr: "pipe",
  },
);

afterAll(() => {
  serveProc.kill();
  dispatchProc.kill();
});

async function waitForServer(url: string, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await Bun.sleep(250);
  }
  throw new Error(`${url} did not become ready in time`);
}

test("serve boots, answers healthcheck, and enforces basic auth", async () => {
  await waitForServer(`${BASE}/healthcheck`);

  const health = await fetch(`${BASE}/healthcheck`);
  expect(health.status).toBe(200);
  expect(((await health.json()) as { status: string }).status).toBe("ok");

  // Bootstrap config is public (mirrors the standalone/Docker behavior).
  expect((await fetch(`${BASE}/api/config`)).status).toBe(200);

  // A protected admin route requires the configured credentials.
  const protectedUrl = `${BASE}/api/applications`;
  expect((await fetch(protectedUrl)).status).toBe(401);
  expect(
    (await fetch(protectedUrl, { headers: { authorization: `Basic ${btoa("admin:wrong")}` } }))
      .status,
  ).toBe(401);
  expect(
    (await fetch(protectedUrl, { headers: { authorization: `Basic ${btoa("admin:secret")}` } }))
      .status,
  ).toBe(200);
});

test("dispatch (split-worker) serves only the healthcheck", async () => {
  const base = `http://localhost:${DISPATCH_PORT}`;
  await waitForServer(`${base}/healthcheck`);

  const health = await fetch(`${base}/healthcheck`);
  expect(health.status).toBe(200);
  expect(((await health.json()) as { dispatcher: string }).dispatcher).toBe("running");

  // No panel/API in the worker — anything else is a 404.
  expect((await fetch(`${base}/api/applications`)).status).toBe(404);
});
