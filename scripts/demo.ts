/**
 * One-command demo: boot a throwaway standalone server (in-memory, no auth)
 * plus an embedded demo receiver, seed a complete dataset, then keep both
 * running so you can browse while the dispatcher delivers for real.
 *
 *   bun run demo            # → http://localhost:7789
 *   PORT=3000 bun run demo
 *
 * The retry schedule is compressed to seconds so retries and dead-letters
 * happen while you watch. Ctrl-C stops everything. Nothing is persisted
 * (memory storage).
 *
 * @module
 */

import { seed, startDemoReceiver } from "./seed-demo.ts";

const PORT = process.env.PORT ?? "7789";
const BASE = `http://localhost:${PORT}`;

// The receiver the seeded endpoints point at — lives in THIS process so the
// dispatcher (in the server process) produces real attempt history against it.
const receiver = await startDemoReceiver();

const server = Bun.spawn(["bun", "apps/standalone/src/index.ts"], {
  env: {
    ...process.env,
    PORT,
    AUTH_MODE: "none",
    STORAGE_DRIVER: "memory",
    TITLE: "Webhooks Demo",
    // Fast schedule: retries in seconds, so the always-500 endpoint walks the
    // whole schedule into a dead-letter within ~10s of its first attempt.
    RETRY_SCHEDULE: "0s,1s,2s,5s",
  },
  stdout: "inherit",
  stderr: "inherit",
});

const shutdown = () => {
  server.kill();
  void receiver.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Wait for the healthcheck before seeding.
async function waitForServer(timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/healthcheck`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await Bun.sleep(200);
  }
  throw new Error(`server did not become ready at ${BASE} within ${timeoutMs}ms`);
}

try {
  await waitForServer();
  await seed(BASE, receiver.url);
  console.log("\nDemo server running — press Ctrl-C to stop.\n");
} catch (err) {
  console.error("Demo failed:", err instanceof Error ? err.message : err);
  server.kill();
  await receiver.close();
  process.exit(1);
}

// Keep the process alive alongside the server.
await server.exited;
