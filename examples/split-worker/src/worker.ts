/**
 * The WORKER process: a dispatcher (and nothing else) over the same storage
 * the web process writes to. This is what `xtandard-webhooks dispatch` does —
 * shown here as code so you can see there is no magic:
 *
 *   bun run src/worker.ts
 *
 * Or, with the CLI against the same directory:
 *
 *   STORAGE_DRIVER=file STORAGE_FILE_DIR=./.webhooks bunx xtandard-webhooks dispatch
 *
 * Run several for throughput — claims are leased, so workers never double-send.
 */
import { createDispatcher, createWebhooksCore } from "@xtandard/webhooks";
import { createFileStorage } from "@xtandard/webhooks/storage/file";

const core = createWebhooksCore({
  // MUST match the web process's storage — that shared queue IS the contract
  // between the two processes.
  storage: createFileStorage({ dir: "./.webhooks" }),
  onDelivery: (event) => {
    const status = event.httpStatus ?? "network-error";
    console.log(
      `[worker] ${event.eventType} attempt #${event.attemptNumber} → ${status}` +
        `${event.ok ? "" : event.terminal ? " (dead-lettered)" : " (will retry)"}`,
    );
  },
});

const dispatcher = createDispatcher(core);
dispatcher.start();
console.log("[worker] dispatcher running over ./.webhooks — deliveries flow while I live.");

// Dispatcher timers are unref()ed by design; hold the event loop open.
setInterval(() => {}, 2 ** 30);
