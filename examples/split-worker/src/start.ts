/**
 * Convenience: boot BOTH processes (web + worker) with one command, each with
 * its own prefix-free stdout so you can watch them interleave.
 *
 *   bun run start             # honors PORT for the web process
 *
 * In production these are two deployments — see ../README.md.
 */
const web = Bun.spawn(["bun", "run", "src/web.ts"], {
  env: process.env,
  stdout: "inherit",
  stderr: "inherit",
});
const worker = Bun.spawn(["bun", "run", "src/worker.ts"], {
  env: process.env,
  stdout: "inherit",
  stderr: "inherit",
});

const shutdown = () => {
  web.kill();
  worker.kill();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await Promise.race([web.exited, worker.exited]);
shutdown();
