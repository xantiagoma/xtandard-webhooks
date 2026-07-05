/**
 * Integration test for the CLI `listen` command — the local inspecting
 * receiver. Boots it in a subprocess (the command never resolves), signs a
 * request with `sign`-equivalent primitives, POSTs it, and asserts the
 * verified-signature path and the wrong-secret 401 path. Runs under `bun test`.
 *
 *   bun test test/cli-listen.bun.test.ts
 */
import { afterAll, expect, test } from "bun:test";
import { generateSecret, signatureHeader } from "../src/signing.ts";

const PORT = 4415;
const BASE = `http://localhost:${PORT}`;
const SECRET = generateSecret();

const proc = Bun.spawn(
  ["bun", "-e", `import('./src/cli.ts').then((m) => m.run(['listen','--secret','${SECRET}']))`],
  {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdout: "pipe",
    stderr: "pipe",
  },
);

afterAll(() => {
  proc.kill();
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

test("listen verifies a correctly-signed webhook (200) and rejects a bad one (401)", async () => {
  await waitForServer(`${BASE}/healthcheck`);

  const id = "msg_listen";
  const ts = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ type: "t", timestamp: "now", data: { ok: true } });
  const good = await fetch(`${BASE}/hooks`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": String(ts),
      "webhook-signature": await signatureHeader([SECRET], id, ts, body),
    },
    body,
  });
  expect(good.status).toBe(200);

  const bad = await fetch(`${BASE}/hooks`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": String(ts),
      "webhook-signature": "v1,not-a-real-signature",
    },
    body,
  });
  expect(bad.status).toBe(401);
});
