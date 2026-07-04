/**
 * Testing utilities — `@xtandard/webhooks/testing`.
 *
 * Everything a host app (or this package's own suite) needs to test its
 * webhook wiring without the network or timers:
 *
 * - {@link createTestWebhooks}: an in-memory core + a **not-started** dispatcher,
 *   driven manually via `dispatcher.tick()` / {@link drainDeliveries}.
 * - {@link createTestReceiver}: a real local HTTP server that records (and,
 *   given the secret, verifies) every delivery it receives — including
 *   programmable failures to exercise the retry path.
 *
 * @module
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createWebhooksCore, type WebhooksCore, type WebhooksCoreOptions } from "./core.ts";
import { createDispatcher, type Dispatcher, type DispatcherOptions } from "./dispatcher.ts";
import type { WebhookEnvelope } from "./schema.ts";
import { verify } from "./signing.ts";
import { createMemoryStorage, type MemoryWebhooksStorage } from "./storage/memory.ts";

/** Options for {@link createTestWebhooks}. */
export interface TestWebhooksOptions extends Omit<WebhooksCoreOptions, "storage" | "queueStorage"> {
  /** Dispatcher config; a fast all-immediate retry schedule is the default. */
  dispatcher?: DispatcherOptions;
}

/** Result of {@link createTestWebhooks}. */
export interface TestWebhooks {
  core: WebhooksCore;
  storage: MemoryWebhooksStorage;
  /** NOT started — drive it with `tick()` or {@link drainDeliveries}. */
  dispatcher: Dispatcher;
}

/**
 * An in-memory core + dispatcher for tests. The dispatcher is **not started**
 * (no timers) and defaults to an immediate three-attempt retry schedule so
 * failure paths drain in a few ticks.
 *
 * @example
 * ```ts
 * import { createTestWebhooks, drainDeliveries } from "@xtandard/webhooks/testing";
 *
 * const { core, dispatcher } = createTestWebhooks();
 * await core.createApplication({ key: "acme" });
 * // … create an endpoint, publish, then:
 * await drainDeliveries(dispatcher);
 * ```
 */
export function createTestWebhooks(options: TestWebhooksOptions = {}): TestWebhooks {
  const storage = createMemoryStorage();
  const { dispatcher: dispatcherOptions, ...coreOptions } = options;
  const core = createWebhooksCore({
    storage,
    allowInsecureUrls: true, // test receivers are local http
    ...coreOptions,
    dispatcher: {
      retrySchedule: ["0s", "0s", "0s"],
      ...dispatcherOptions,
    },
  });
  const dispatcher = createDispatcher(core);
  return { core, storage, dispatcher };
}

/** Options for {@link createTestReceiver}. */
export interface TestReceiverOptions {
  /**
   * When set, each request is verified against this secret and its parsed
   * envelope lands in `received`; an invalid signature answers 401.
   */
  secret?: string;
  /** Fail (with `status`) the first N requests — exercises the retry path. */
  failFirst?: number;
  /** The failure status used while failing. Default `500`. */
  status?: number;
}

/** A running test receiver. */
export interface TestReceiver {
  /** The local URL to register as an endpoint. */
  url: string;
  /** Verified envelopes (only populated when `secret` was provided). */
  received: WebhookEnvelope[];
  /** Every request, verified or not, in arrival order. */
  requests: { headers: Record<string, string>; body: string }[];
  close(): Promise<void>;
}

/**
 * Start a real local HTTP server that plays the receiving side of a webhook.
 * Works under Bun and Node.
 *
 * @example
 * ```ts
 * const receiver = await createTestReceiver({ secret, failFirst: 2 });
 * await core.createEndpoint("acme", { url: receiver.url });
 * // … publish + drain; receiver.received now holds the verified envelopes.
 * await receiver.close();
 * ```
 */
export async function createTestReceiver(options: TestReceiverOptions = {}): Promise<TestReceiver> {
  const received: WebhookEnvelope[] = [];
  const requests: { headers: Record<string, string>; body: string }[] = [];
  let remainingFailures = options.failFirst ?? 0;

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      void (async () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(req.headers)) {
          if (typeof value === "string") headers[name] = value;
        }
        requests.push({ headers, body });

        if (remainingFailures > 0) {
          remainingFailures--;
          res.writeHead(options.status ?? 500, { "content-type": "text/plain" });
          res.end("simulated failure");
          return;
        }

        if (options.secret) {
          try {
            received.push(await verify({ payload: body, headers, secret: options.secret }));
          } catch {
            res.writeHead(401, { "content-type": "text/plain" });
            res.end("invalid signature");
            return;
          }
        }
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
      })();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Test receiver failed to bind a port");
  }

  return {
    url: `http://127.0.0.1:${address.port}/webhooks`,
    received,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

/**
 * Tick the dispatcher until a pass makes no attempts (or `maxTicks` is hit).
 * Pair with an all-immediate retry schedule ({@link createTestWebhooks}'s
 * default) so failed deliveries are due again on the very next tick.
 */
export async function drainDeliveries(dispatcher: Dispatcher, maxTicks = 25): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    if ((await dispatcher.tick()) === 0) return;
  }
}
