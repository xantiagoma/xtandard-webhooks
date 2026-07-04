/**
 * The delivery engine. Polls the due index, claims deliveries (lease-based,
 * multi-instance safe when storage supports CAS or the `deliveryQueue`
 * capability), performs the signed HTTP attempts, and drives each delivery's
 * state machine through the retry schedule into success or dead-letter.
 *
 * Runs in-process: the panel starts one by default, a split worker runs one
 * via the CLI (`xtandard-webhooks dispatch`), and tests drive {@link Dispatcher.tick}
 * manually. All timers are `unref()`ed so a dispatcher never keeps a process
 * alive on its own. Semantics are **at-least-once**: a crashed process loses
 * nothing (leases expire, the next tick reclaims); receivers dedupe on
 * `webhook-id`.
 *
 * @module
 */

import { attemptDelivery, type AttemptOutcome } from "./deliver.ts";
import type { WebhooksCore } from "./core.ts";
import { durationToMs } from "./duration.ts";
import { deliveryKey, dueKey, type DueEntry } from "./keys.ts";
import type { Delivery, WebhookDuration } from "./schema.ts";
import { VERSION } from "./version.ts";

/** Options for {@link createDispatcher} (also accepted on panels and the core). */
export interface DispatcherOptions {
  /** How often to poll for due deliveries. Default `1000`. */
  pollIntervalMs?: number;
  /** Max deliveries claimed per tick. Default `20`. */
  batchSize?: number;
  /** Max in-flight HTTP attempts. Default `8`. */
  concurrency?: number;
  /** Per-attempt timeout (AbortController). Default `20_000`. */
  timeoutMs?: number;
  /** Claim lease duration; an expired lease makes a claim reclaimable. Default `60_000`. */
  leaseMs?: number;
  /**
   * Delay before attempt N+1 after attempt N fails (index 0 = the initial
   * attempt's delay). Exhausting the schedule dead-letters the delivery.
   * Default `["0s", "5s", "5m", "30m", "2h", "5h", "10h"]` (Svix-compatible).
   */
  retrySchedule?: WebhookDuration[];
  /**
   * Auto-disable endpoints whose every attempt has failed for this many
   * consecutive days. `false` disables the policy. Default `{ failingForDays: 5 }`.
   */
  autoDisable?: { failingForDays?: number } | false;
  /** Cap on stored response-body characters per attempt. Default `4096`. */
  responseBodyLimit?: number;
  /** Injectable fetch (tests, instrumentation). Default: global fetch. */
  fetch?: typeof fetch;
  /** `user-agent` header. Default `"xtandard-webhooks/<version>"`. */
  userAgent?: string;
}

/** The delivery engine handle. */
export interface Dispatcher {
  /** Begin polling. Idempotent. */
  start(): void;
  /** Stop polling and wait for in-flight attempts to finish. */
  stop(): Promise<void>;
  /**
   * Run one manual pass: claim due deliveries, attempt them, record outcomes.
   * Returns the number of attempts made — the unit-test surface (tests never
   * assert on timers).
   */
  tick(): Promise<number>;
  readonly running: boolean;
}

/** The default retry schedule (Svix-compatible). */
export const DEFAULT_RETRY_SCHEDULE: WebhookDuration[] = [
  "0s",
  "5s",
  "5m",
  "30m",
  "2h",
  "5h",
  "10h",
];

/** Fractional jitter applied to every retry delay (±10%). */
const JITTER = 0.1;

/**
 * Create a dispatcher over a core. Not started — call
 * {@link Dispatcher.start}, or drive {@link Dispatcher.tick} manually.
 *
 * @example
 * ```ts
 * import { createWebhooksCore, createDispatcher } from "@xtandard/webhooks";
 * import { createMemoryStorage } from "@xtandard/webhooks/storage/memory";
 *
 * const core = createWebhooksCore({ storage: createMemoryStorage() });
 * const dispatcher = createDispatcher(core);
 * dispatcher.start();
 * ```
 */
export function createDispatcher(core: WebhooksCore, options: DispatcherOptions = {}): Dispatcher {
  const merged = { ...core.options.dispatcher, ...options };
  const pollIntervalMs = merged.pollIntervalMs ?? 1000;
  const batchSize = merged.batchSize ?? 20;
  const concurrency = merged.concurrency ?? 8;
  const timeoutMs = merged.timeoutMs ?? 20_000;
  const leaseMs = merged.leaseMs ?? 60_000;
  const schedule = merged.retrySchedule ?? DEFAULT_RETRY_SCHEDULE;
  const autoDisable = merged.autoDisable ?? { failingForDays: 5 };
  const responseBodyLimit = merged.responseBodyLimit ?? 4096;
  const userAgent = merged.userAgent ?? `xtandard-webhooks/${VERSION}`;
  const doFetch = merged.fetch;
  const now = core.options.now;

  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<number> | null = null;

  /** Delay before the next attempt, per schedule position, with ±10% jitter. */
  function nextDelayMs(attemptsMade: number): number | null {
    if (attemptsMade >= schedule.length) return null; // exhausted
    const nominal = durationToMs(schedule[attemptsMade] as WebhookDuration);
    const jitter = 1 + (Math.random() * 2 - 1) * JITTER;
    return Math.round(nominal * jitter);
  }

  async function processClaim(delivery: Delivery): Promise<boolean> {
    const app = delivery.applicationKey;
    const trigger = delivery.pendingTrigger ?? "schedule";

    const failTerminal = async (error: string, eventType: string): Promise<boolean> => {
      const outcome: AttemptOutcome = {
        ok: false,
        error,
        durationMs: 0,
        at: new Date(now()).toISOString(),
      };
      await core.recordAttempt({ delivery, outcome, trigger, nextAttemptAt: null, eventType });
      return true;
    };

    const message = await core.getMessage(app, delivery.messageId);
    if (!message) return failTerminal("Message no longer exists", "unknown");

    const endpoint = await core.getEndpoint(app, delivery.endpointId);
    if (!endpoint) return failTerminal("Endpoint no longer exists", message.eventType);

    if (endpoint.disabled) {
      // Held, not failed: release the claim and re-check after the lease
      // window. Re-enabling the endpoint resumes delivery automatically.
      const queue = core.options.queueStorage;
      const recheckAt = now() + leaseMs;
      const released: Delivery = {
        ...delivery,
        status: "pending",
        nextAttemptAt: new Date(recheckAt).toISOString(),
        leaseUntil: null,
        updatedAt: new Date(now()).toISOString(),
      };
      // Remove the lease-position due entry the claim created, then park the
      // delivery at the recheck time.
      if (delivery.leaseUntil) {
        await queue.removeItem(dueKey(app, Date.parse(delivery.leaseUntil), delivery.id));
      }
      await queue.setItem(deliveryKey(app, delivery.id), released);
      await queue.setItem<DueEntry>(dueKey(app, recheckAt, delivery.id), {
        app,
        deliveryId: delivery.id,
      });
      return false; // no attempt made
    }

    const outcome = await attemptDelivery({
      endpoint,
      messageId: delivery.messageId,
      body: message.envelope,
      timeoutMs,
      responseBodyLimit,
      userAgent,
      ...(doFetch ? { fetch: doFetch } : {}),
      nowMs: now(),
    });

    const attemptsMade = delivery.attemptCount + 1;
    const delay = outcome.ok ? null : nextDelayMs(attemptsMade);
    await core.recordAttempt({
      delivery,
      outcome,
      trigger,
      nextAttemptAt: delay === null ? null : new Date(now() + delay).toISOString(),
      eventType: message.eventType,
    });
    await core.noteEndpointOutcome(app, endpoint.id, outcome.ok, autoDisable);
    return true;
  }

  async function runTick(): Promise<number> {
    const claimed = await core.claimDueDeliveries({ limit: batchSize, leaseMs });
    if (claimed.length === 0) return 0;

    let attempts = 0;
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, claimed.length) }, async () => {
      while (cursor < claimed.length) {
        const delivery = claimed[cursor++] as Delivery;
        try {
          if (await processClaim(delivery)) attempts++;
        } catch (error) {
          // A storage failure mid-claim: leave the delivery leased; the lease
          // expiry re-exposes it. Never let one claim kill the tick.
          // eslint-disable-next-line no-console
          console.warn(`[@xtandard/webhooks] delivery ${delivery.id} processing failed:`, error);
        }
      }
    });
    await Promise.all(workers);
    return attempts;
  }

  const dispatcher: Dispatcher = {
    start() {
      if (timer) return;
      timer = setInterval(() => {
        if (inFlight) return; // never overlap ticks
        inFlight = runTick()
          .catch((error) => {
            // eslint-disable-next-line no-console
            console.warn("[@xtandard/webhooks] dispatcher tick failed:", error);
            return 0;
          })
          .finally(() => {
            inFlight = null;
          });
      }, pollIntervalMs);
      // Never keep the host process alive just to poll.
      (timer as unknown as { unref?: () => void }).unref?.();
    },

    async stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (inFlight) await inFlight;
    },

    async tick() {
      // Manual ticks also serialize against the poller.
      while (inFlight) await inFlight;
      inFlight = runTick().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },

    get running() {
      return timer !== null;
    },
  };

  return dispatcher;
}
