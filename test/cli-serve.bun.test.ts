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
const OPEN_PORT = 4415;
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

// Empty AUTH_MODE means the default `none` (not an unknown mode).
const openProc = Bun.spawn(["bun", "-e", "import('./src/cli.ts').then((m) => m.run(['serve']))"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(OPEN_PORT),
    AUTH_MODE: "",
    STORAGE_DRIVER: "memory",
    DISPATCHER: "0",
  },
  stdout: "pipe",
  stderr: "pipe",
});

afterAll(() => {
  serveProc.kill();
  dispatchProc.kill();
  openProc.kill();
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

test("serve exits non-zero on an unknown AUTH_MODE instead of serving an open panel", async () => {
  const proc = Bun.spawn(
    [
      "bun",
      "-e",
      "import('./src/cli.ts').then((m) => m.run(['serve'])).then((code) => process.exit(code))",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(OPEN_PORT + 1),
        AUTH_MODE: "basci",
        STORAGE_DRIVER: "memory",
        DISPATCHER: "0",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const timeout = setTimeout(() => proc.kill(), 20_000);
  const code = await proc.exited;
  clearTimeout(timeout);
  expect(code).not.toBe(0);
  expect(await new Response(proc.stderr).text()).toContain(
    'Unknown AUTH_MODE "basci" (expected none or basic)',
  );
  expect(await new Response(proc.stdout).text()).not.toContain("listening");
});

test("serve with an empty AUTH_MODE defaults to none", async () => {
  const base = `http://localhost:${OPEN_PORT}`;
  await waitForServer(`${base}/healthcheck`);
  expect((await fetch(`${base}/api/applications`)).status).toBe(200);
});
