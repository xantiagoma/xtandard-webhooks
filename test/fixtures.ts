/**
 * Shared test fixtures: an injectable clock, a fake fetch, and a fully wired
 * in-memory core + dispatcher builder.
 *
 * @module
 */

import { createWebhooksCore, type WebhooksCore, type WebhooksCoreOptions } from "../src/core.ts";
import { createDispatcher, type Dispatcher, type DispatcherOptions } from "../src/dispatcher.ts";
import { createMemoryStorage, type MemoryWebhooksStorage } from "../src/storage/memory.ts";
import type { WebhooksStorage, CompareAndSwapWebhooksStorage } from "../src/storage/contract.ts";

export const T0 = Date.parse("2026-07-04T12:00:00.000Z");

/** A manually advanced clock. */
export interface TestClock {
  now: () => number;
  advance(ms: number): void;
  set(ms: number): void;
}

export function createClock(start = T0): TestClock {
  let value = start;
  return {
    now: () => value,
    advance(ms) {
      value += ms;
    },
    set(ms) {
      value = ms;
    },
  };
}

/** One captured request seen by {@link fakeFetch}. */
export interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** A programmable fetch: `respond` decides each response; requests are recorded. */
export function fakeFetch(
  respond: (request: CapturedRequest, index: number) => Response | Promise<Response>,
): { fetch: typeof fetch; requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const request: CapturedRequest = { url, headers, body: String(init?.body ?? "") };
    requests.push(request);
    return respond(request, requests.length - 1);
  }) as typeof fetch;
  return { fetch: impl, requests };
}

export const ok = () => new Response("ok", { status: 200 });
export const failWith = (status: number, body = "boom") => new Response(body, { status });

/** Options for {@link setupWebhooks}. */
export interface SetupOptions extends Omit<WebhooksCoreOptions, "storage" | "now"> {
  clock?: TestClock;
  storage?: WebhooksStorage;
  dispatcher?: DispatcherOptions;
}

export interface Setup {
  core: WebhooksCore;
  dispatcher: Dispatcher;
  storage: WebhooksStorage;
  clock: TestClock;
}

/** A wired core + (not started) dispatcher over memory storage with a test clock. */
export function setupWebhooks(options: SetupOptions = {}): Setup {
  const clock = options.clock ?? createClock();
  const storage = options.storage ?? createMemoryStorage();
  const { clock: _c, storage: _s, dispatcher, ...coreOptions } = options;
  const core = createWebhooksCore({
    storage,
    allowInsecureUrls: true,
    now: clock.now,
    ...coreOptions,
    dispatcher: { retrySchedule: ["0s", "0s", "0s"], ...dispatcher },
  });
  return { core, dispatcher: createDispatcher(core), storage, clock };
}

/** A ready-made app + event type + endpoint on a fresh setup. */
export async function seedBasics(core: WebhooksCore, url = "http://127.0.0.1:9/hooks") {
  await core.createApplication({ key: "acme", name: "Acme" });
  await core.upsertEventType({ name: "invoice.paid", description: "An invoice was paid" });
  const endpoint = await core.createEndpoint("acme", { url });
  return { endpoint };
}

/**
 * Strip the native `claimDue` (and optionally `compareAndSwap`) capability off
 * the memory adapter so tests can exercise the core's generic due-index scan
 * fallback.
 */
export function withoutQueueCapability(
  base: MemoryWebhooksStorage,
  keep: { cas: boolean },
): WebhooksStorage | (WebhooksStorage & CompareAndSwapWebhooksStorage) {
  const storage: WebhooksStorage = {
    getItem: (k) => base.getItem(k),
    setItem: (k, v) => base.setItem(k, v),
    removeItem: (k) => base.removeItem(k),
    getKeys: (p) => base.getKeys(p),
  };
  if (keep.cas) {
    return {
      ...storage,
      compareAndSwap: (input) => base.compareAndSwap(input),
    } satisfies WebhooksStorage & CompareAndSwapWebhooksStorage;
  }
  return storage;
}
