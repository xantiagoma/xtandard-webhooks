/**
 * Admin + publish core — the operations layer the API, CLI, and dispatcher sit
 * on top of.
 *
 * Owns the split between the **control plane** (CRUD on applications / event
 * types / endpoints, browsing messages and deliveries, replay — rare,
 * human-driven, hook-guarded, audited) and the **delivery plane** (`publish()`
 * + the dispatcher's claim/record internals — the hot path). `publish()` never
 * performs an HTTP call and never throws because an endpoint is down: it
 * persists one message and fans out one pending delivery per matching enabled
 * endpoint; the dispatcher owns all network I/O.
 *
 * Storage can be split: control data lives in `storage`, while deliveries +
 * the due index live in `queueStorage` (defaults to `storage`) — e.g. control
 * in Postgres, queue in Redis.
 *
 * @module
 */

import { canonicalStringify } from "./canonical.ts";
import {
  attemptDelivery,
  buildSignedRequest,
  type AttemptOutcome,
  type SignedRequest,
} from "./deliver.ts";
import {
  emitDelivery,
  type DeliveryErrorReporter,
  type DeliveryListener,
} from "./delivery-sink.ts";
import type { DispatcherOptions } from "./dispatcher.ts";
import { durationToMs } from "./duration.ts";
import { newId } from "./id.ts";
import {
  applicationMetaKey,
  applicationPrefix,
  applicationsKey,
  attemptKey,
  attemptsPrefix,
  auditLogKey,
  byEndpointKey,
  byEndpointPrefix,
  byMessageKey,
  byMessagePrefix,
  deliveriesPrefix,
  deliveryKey,
  dueKey,
  endpointKey,
  endpointsKey,
  eventTypeKey,
  eventTypesKey,
  globalAuditLogKey,
  idempotencyKey,
  lastSegment,
  messageKey,
  messagesPrefix,
  type DueEntry,
} from "./keys.ts";
import type {
  Actor,
  Application,
  AuditEntry,
  Delivery,
  DeliveryAttempt,
  Endpoint,
  EventType,
  JsonValue,
  Message,
  WebhookDuration,
} from "./schema.ts";
import { isTerminalDeliveryStatus } from "./schema.ts";
import { generateSecret } from "./signing.ts";
import { VERSION } from "./version.ts";
import { hasDeliveryQueue, isCompareAndSwap, type WebhooksStorage } from "./storage/contract.ts";
import type {
  AfterEvent,
  BeforeEvent,
  HookErrorReporter,
  WebhooksHooks,
  WebhooksHooksInput,
} from "./hooks/contract.ts";
import { defaultHookErrorReporter, normalizeHooks, runAfter, runBefore } from "./hooks/contract.ts";
import {
  assertValid,
  validateApplication,
  validateEndpoint,
  validateEventType,
  validateKeySegment,
  ValidationError,
} from "./validation.ts";

/** Thrown by mutating operations when the core is in readonly mode. */
export class ReadonlyError extends Error {
  constructor(operation: string) {
    super(`Cannot ${operation}: @xtandard/webhooks is in readonly mode.`);
    this.name = "ReadonlyError";
  }
}

/** Thrown when a referenced application/event type/endpoint/delivery does not exist. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

/** Thrown when creating an entity whose key already exists. Maps to HTTP 409. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/** Thrown by {@link WebhooksCore.publish} when the payload exceeds the limit. Maps to 413. */
export class PayloadTooLargeError extends Error {
  constructor(size: number, limit: number) {
    super(`Payload is ${size} bytes; the limit is ${limit} bytes.`);
    this.name = "PayloadTooLargeError";
  }
}

/**
 * Thrown by {@link WebhooksCore.publish} when an idempotency key is reused with
 * a **different** payload (same key + same payload returns the original
 * message instead). Maps to HTTP 409.
 */
export class IdempotencyConflictError extends Error {
  constructor(key: string) {
    super(`Idempotency key "${key}" was already used with a different payload.`);
    this.name = "IdempotencyConflictError";
  }
}

/**
 * One retention rule set. When both fields are set, an item is **kept if either
 * rule keeps it** (union of keeps — the same semantics as backup tools): pruned
 * only when it is outside the `keepLast` most recent AND older than `maxAge`.
 */
export interface RetentionRule {
  /** Keep at most the N most recent items. */
  keepLast?: number;
  /** Keep items newer than this age (relative to prune time). */
  maxAge?: WebhookDuration;
}

/** Retention policy for {@link WebhooksCoreOptions.retention}. */
export interface RetentionOptions {
  /**
   * Prune old messages, cascading their deliveries and attempts. Messages with
   * a non-terminal delivery are never pruned (the dispatcher still needs them).
   */
  messages?: RetentionRule;
  /** Prune old audit entries. */
  audit?: RetentionRule;
}

/** Options for {@link createWebhooksCore}. */
export interface WebhooksCoreOptions {
  /** Control-plane store: applications, event types, endpoints, messages, audit. */
  storage: WebhooksStorage;
  /**
   * Store for deliveries, attempts, and the due index. Defaults to `storage`.
   * Splitting lets control data live in Postgres while the queue lives in Redis.
   */
  queueStorage?: WebhooksStorage;
  /** When true, all mutating operations throw {@link ReadonlyError}. */
  readonly?: boolean;
  /**
   * Control-plane hooks fired around admin mutations. Pass one hook or an array.
   * `before` hooks run sequentially and may **throw to deny**; `after` hooks run
   * post-commit for side effects and never fail the operation.
   */
  hooks?: WebhooksHooksInput;
  /** Reporter invoked when an `after` hook throws. Defaults to `console.warn`. */
  onHookError?: HookErrorReporter;
  /** Fire-and-forget sink invoked for **every** delivery attempt (metrics tap). */
  onDelivery?: DeliveryListener;
  /** Reporter invoked when the `onDelivery` sink throws/rejects. */
  onDeliveryError?: DeliveryErrorReporter;
  /**
   * Retention policy. Message pruning cascades deliveries/attempts and is
   * non-vetoable; removed payloads are surfaced to `after` hooks
   * (`message.pruned`, `audit.pruned`) so they can be offloaded first. Pruning
   * runs opportunistically after publishes (off the hot path, fire-and-forget)
   * and on demand via {@link WebhooksCore.prune}.
   */
  retention?: RetentionOptions;
  /**
   * Dispatcher configuration, carried here so panels/CLI construct dispatchers
   * consistently. The core itself never starts one — creation is the
   * panel/CLI's job (or yours, via `createDispatcher(core, core.options.dispatcher)`).
   */
  dispatcher?: DispatcherOptions;
  /** Grace window during which a rotated-out secret keeps signing. Default `"24h"`. */
  secretRotationGrace?: WebhookDuration;
  /** Allow `http:` endpoint URLs beyond localhost (dev only; default `false`). */
  allowInsecureUrls?: boolean;
  /** Extra endpoint-URL gate; return `false` to reject (SSRF denylist etc.). */
  urlPolicy?: (url: string) => boolean;
  /** Max serialized payload size accepted by publish. Default `262_144` bytes. */
  payloadLimitBytes?: number;
  /**
   * Whether {@link WebhooksCore.publish} requires the event type to exist in
   * the catalog. Default `true` — a typo'd event type name would otherwise
   * silently deliver to nobody (endpoints subscribe by exact name).
   */
  requireKnownEventTypes?: boolean;
  /** Injectable clock (unix millis) for tests. Default `Date.now`. */
  now?: () => number;
}

/** Per-call actor attribution for audited mutations. */
export interface ActorOptions {
  actor?: Actor | null;
}

/** Input to {@link WebhooksCore.publish}. */
export interface PublishInput {
  eventType: string;
  payload: JsonValue;
  /** ISO-8601 event-occurred time. Defaults to publish time. */
  timestamp?: string;
  /** Dedupe key: same key + same payload within retention returns the existing message. */
  idempotencyKey?: string;
}

/** Result of {@link WebhooksCore.publish}. */
export interface PublishResult {
  message: Message;
  deliveries: Delivery[];
  /** True when an idempotency key matched and the existing message was returned. */
  deduplicated: boolean;
}

/** Pagination + filters for {@link WebhooksCore.listMessages}. */
export interface ListMessagesOptions {
  /** Page size. Default 50, max 200. */
  limit?: number;
  /** Cursor: return items strictly older than the message with this id. */
  before?: string;
  eventType?: string;
}

/** Pagination + filters for {@link WebhooksCore.listDeliveries}. */
export interface ListDeliveriesOptions {
  status?: Delivery["status"];
  endpointId?: string;
  messageId?: string;
  /** Page size. Default 50, max 200. */
  limit?: number;
  /** Cursor: return items strictly older than the delivery with this id. */
  before?: string;
}

/** Input to the dispatcher-facing {@link WebhooksCore.claimDueDeliveries}. */
export interface ClaimInput {
  limit: number;
  leaseMs: number;
}

/** Input to the dispatcher-facing {@link WebhooksCore.recordAttempt}. */
export interface RecordAttemptInput {
  delivery: Delivery;
  outcome: AttemptOutcome;
  trigger: DeliveryAttempt["trigger"];
  /**
   * When the outcome failed: the next attempt time (dispatcher computes the
   * schedule + jitter), or `null` when the schedule is exhausted (dead-letter).
   * Ignored for successful outcomes.
   */
  nextAttemptAt?: string | null;
  /** The message's event type (for the sink event); loaded by the dispatcher anyway. */
  eventType: string;
}

/** Result of {@link WebhooksCore.sendExample}. */
export interface SendExampleResult {
  outcome: AttemptOutcome;
  /** The envelope body that was sent. */
  body: string;
  /** The synthetic message id used as `webhook-id` (not retained). */
  messageId: string;
}

/** Result of {@link WebhooksCore.recoverEndpoint}. */
export interface RecoverResult {
  /** Ids of the failed deliveries that were re-queued. */
  deliveryIds: string[];
}

/** The admin + publish core surface. */
export interface WebhooksCore {
  readonly options: {
    storage: WebhooksStorage;
    queueStorage: WebhooksStorage;
    readonly: boolean;
    /** Normalized hooks (always an array). */
    hooks: WebhooksHooks[];
    retention?: RetentionOptions;
    dispatcher?: DispatcherOptions;
    secretRotationGrace: WebhookDuration;
    allowInsecureUrls: boolean;
    urlPolicy?: (url: string) => boolean;
    payloadLimitBytes: number;
    requireKnownEventTypes: boolean;
    onDelivery?: DeliveryListener;
    onDeliveryError?: DeliveryErrorReporter;
    now: () => number;
  };

  // Applications
  listApplications(): Promise<Application[]>;
  createApplication(
    input: { key: string; name?: string; metadata?: JsonValue },
    options?: ActorOptions,
  ): Promise<Application>;
  getApplication(applicationKey: string): Promise<Application | null>;
  updateApplication(
    applicationKey: string,
    patch: { name?: string; metadata?: JsonValue },
    options?: ActorOptions,
  ): Promise<Application>;
  /** Deletes the application and **everything** under it (endpoints, messages, deliveries). */
  deleteApplication(applicationKey: string, options?: ActorOptions): Promise<void>;

  // Event types (global catalog)
  listEventTypes(): Promise<EventType[]>;
  getEventType(name: string): Promise<EventType | null>;
  upsertEventType(input: EventType, options?: ActorOptions): Promise<EventType>;
  /**
   * Delete an event type. Endpoints referencing it keep their subscription
   * entry and simply stop matching new publishes of that name.
   */
  deleteEventType(name: string, options?: ActorOptions): Promise<void>;

  // Endpoints
  listEndpoints(applicationKey: string): Promise<Endpoint[]>;
  getEndpoint(applicationKey: string, endpointId: string): Promise<Endpoint | null>;
  /** Creates the endpoint and generates its first signing secret. */
  createEndpoint(
    applicationKey: string,
    input: {
      url: string;
      description?: string;
      eventTypes?: string[];
      headers?: Record<string, string>;
      metadata?: JsonValue;
      disabled?: boolean;
    },
    options?: ActorOptions,
  ): Promise<Endpoint>;
  updateEndpoint(
    applicationKey: string,
    endpointId: string,
    patch: {
      url?: string;
      description?: string;
      eventTypes?: string[];
      headers?: Record<string, string>;
      metadata?: JsonValue;
    },
    options?: ActorOptions,
  ): Promise<Endpoint>;
  deleteEndpoint(applicationKey: string, endpointId: string, options?: ActorOptions): Promise<void>;
  /**
   * Mint a new current secret; the previous one keeps verifying until
   * `secretRotationGrace` elapses. Expired grace secrets are pruned lazily.
   */
  rotateSecret(
    applicationKey: string,
    endpointId: string,
    options?: ActorOptions,
  ): Promise<Endpoint>;
  /** The endpoint's secrets (current first). Gate behind `endpoint:read-secret`. */
  getSecrets(applicationKey: string, endpointId: string): Promise<Endpoint["secrets"]>;
  enableEndpoint(
    applicationKey: string,
    endpointId: string,
    options?: ActorOptions,
  ): Promise<Endpoint>;
  disableEndpoint(
    applicationKey: string,
    endpointId: string,
    options?: ActorOptions,
  ): Promise<Endpoint>;

  // Publish (the delivery-plane entry point)
  /**
   * Persist a message and fan out one pending delivery per matching enabled
   * endpoint. Never performs HTTP; never throws because an endpoint is down.
   */
  publish(
    applicationKey: string,
    input: PublishInput,
    options?: ActorOptions,
  ): Promise<PublishResult>;

  // Messages + deliveries (observability)
  listMessages(applicationKey: string, options?: ListMessagesOptions): Promise<Message[]>;
  getMessage(applicationKey: string, messageId: string): Promise<Message | null>;
  listDeliveries(applicationKey: string, options?: ListDeliveriesOptions): Promise<Delivery[]>;
  getDelivery(
    applicationKey: string,
    deliveryId: string,
  ): Promise<{ delivery: Delivery; attempts: DeliveryAttempt[] } | null>;
  /**
   * The exact signed HTTP request this delivery would send **right now** —
   * method, URL, all headers (including the computed `webhook-signature`), and
   * body. The inspector view: shows what a receiver gets, without sending.
   * Returns `null` if the delivery or its endpoint no longer exists. The
   * `webhook-timestamp`/signature reflect the current time (they change per
   * attempt by design); the id and body are stable.
   */
  previewDeliveryRequest(applicationKey: string, deliveryId: string): Promise<SignedRequest | null>;
  /** Re-queue a dead-lettered delivery (`failed` → `pending`, due immediately). */
  retryDelivery(
    applicationKey: string,
    deliveryId: string,
    options?: ActorOptions,
  ): Promise<Delivery>;
  /** Re-queue every failed delivery for an endpoint created at/after `since`. */
  recoverEndpoint(
    applicationKey: string,
    endpointId: string,
    input: { since: string },
    options?: ActorOptions,
  ): Promise<RecoverResult>;
  /**
   * Fire a one-off signed test delivery at an endpoint, synchronously, through
   * the same wire path as real deliveries (`trigger: "test"`). The synthetic
   * message is not retained.
   */
  sendExample(
    applicationKey: string,
    endpointId: string,
    input: { eventType: string; payload?: JsonValue },
    options?: ActorOptions,
  ): Promise<SendExampleResult>;

  // Audit
  /** Newest-first. With `applicationKey`: that app's log; without: global + all apps. */
  listAudit(applicationKey?: string): Promise<AuditEntry[]>;

  // Retention
  /** Run retention now (also runs opportunistically after publishes). */
  prune(): Promise<void>;

  // Dispatcher internals (exported for advanced users / custom dispatchers)
  /**
   * Claim up to `limit` due deliveries for exclusive processing. Uses the
   * storage's native `claimDue` when available; otherwise scans the due index
   * with compare-and-swap claiming (plain read-modify-write when the storage
   * has no CAS — single-dispatcher assumption, see docs/DELIVERY.md).
   */
  claimDueDeliveries(input: ClaimInput): Promise<Delivery[]>;
  /** Record one attempt's outcome and advance the delivery's state machine. */
  recordAttempt(input: RecordAttemptInput): Promise<Delivery>;
  /**
   * Update the endpoint's failure streak after an attempt (any success clears
   * it) and auto-disable once the streak exceeds `failingForDays`. Returns the
   * endpoint when it was auto-disabled by this call.
   */
  noteEndpointOutcome(
    applicationKey: string,
    endpointId: string,
    ok: boolean,
    policy?: { failingForDays?: number } | false,
  ): Promise<Endpoint | null>;
}

const DEFAULT_PAYLOAD_LIMIT = 262_144;
const DEFAULT_ROTATION_GRACE: WebhookDuration = "24h";
const MAX_PAGE = 200;
const DEFAULT_PAGE = 50;

/**
 * Construct the core over the configured storage.
 *
 * @example
 * ```ts
 * import { createWebhooksCore } from "@xtandard/webhooks";
 * import { createMemoryStorage } from "@xtandard/webhooks/storage/memory";
 *
 * const core = createWebhooksCore({ storage: createMemoryStorage() });
 *
 * await core.createApplication({ key: "acme" });
 * await core.upsertEventType({ name: "invoice.paid" });
 * const endpoint = await core.createEndpoint("acme", {
 *   url: "https://api.acme-customer.com/webhooks",
 *   eventTypes: ["invoice.paid"],
 * });
 *
 * // The hot path — call this from your app code:
 * await core.publish("acme", {
 *   eventType: "invoice.paid",
 *   payload: { invoiceId: "inv_1", amount: 4200 },
 * });
 * ```
 */
export function createWebhooksCore(options: WebhooksCoreOptions): WebhooksCore {
  const storage = options.storage;
  const queueStorage = options.queueStorage ?? options.storage;
  const readonly = options.readonly ?? false;
  const hooks = normalizeHooks(options.hooks);
  const onHookError = options.onHookError ?? defaultHookErrorReporter;
  const secretRotationGrace = options.secretRotationGrace ?? DEFAULT_ROTATION_GRACE;
  const payloadLimitBytes = options.payloadLimitBytes ?? DEFAULT_PAYLOAD_LIMIT;
  const requireKnownEventTypes = options.requireKnownEventTypes ?? true;
  const now = options.now ?? Date.now;
  const urlOptions = {
    allowInsecureUrls: options.allowInsecureUrls ?? false,
    ...(options.urlPolicy ? { urlPolicy: options.urlPolicy } : {}),
  };

  const guard = (op: string) => {
    if (readonly) throw new ReadonlyError(op);
  };

  const before = hooks.length ? (event: BeforeEvent) => runBefore(hooks, event) : null;
  const after = hooks.length ? (event: AfterEvent) => runAfter(hooks, event, onHookError) : null;

  const nowIso = () => new Date(now()).toISOString();

  // ---------------------------------------------------------------- helpers

  async function indexAdd(store: WebhooksStorage, key: string, value: string): Promise<void> {
    const list = (await store.getItem<string[]>(key)) ?? [];
    if (!list.includes(value)) {
      list.push(value);
      await store.setItem(key, list);
    }
  }

  async function indexRemove(store: WebhooksStorage, key: string, value: string): Promise<void> {
    const list = (await store.getItem<string[]>(key)) ?? [];
    const next = list.filter((v) => v !== value);
    if (next.length !== list.length) await store.setItem(key, next);
  }

  async function appendAudit(
    entry: Omit<AuditEntry, "at"> & { at?: string },
    scope: "app" | "global" = "app",
  ): Promise<void> {
    const key =
      scope === "global" || !entry.applicationKey
        ? globalAuditLogKey()
        : auditLogKey(entry.applicationKey);
    const log = (await storage.getItem<AuditEntry[]>(key)) ?? [];
    log.push({ at: nowIso(), ...entry });
    await storage.setItem(key, log);
  }

  async function requireApplication(applicationKey: string): Promise<Application> {
    const app = await storage.getItem<Application>(applicationMetaKey(applicationKey));
    if (!app) throw new NotFoundError(`Application "${applicationKey}" does not exist.`);
    return app;
  }

  async function requireEndpoint(applicationKey: string, endpointId: string): Promise<Endpoint> {
    await requireApplication(applicationKey);
    const endpoint = await storage.getItem<Endpoint>(endpointKey(applicationKey, endpointId));
    if (!endpoint) {
      throw new NotFoundError(
        `Endpoint "${endpointId}" does not exist in application "${applicationKey}".`,
      );
    }
    return endpoint;
  }

  /** Write a delivery + its due-index entry (they always move together). */
  async function writeDeliveryWithDue(delivery: Delivery, dueAtMillis: number): Promise<void> {
    await queueStorage.setItem(deliveryKey(delivery.applicationKey, delivery.id), delivery);
    await queueStorage.setItem<DueEntry>(
      dueKey(delivery.applicationKey, dueAtMillis, delivery.id),
      { app: delivery.applicationKey, deliveryId: delivery.id },
    );
  }

  /** Remove the due entry a delivery currently occupies, wherever it is. */
  async function removeDueEntry(delivery: Delivery): Promise<void> {
    const candidates: number[] = [];
    if (delivery.nextAttemptAt) candidates.push(Date.parse(delivery.nextAttemptAt));
    if (delivery.leaseUntil) candidates.push(Date.parse(delivery.leaseUntil));
    for (const millis of candidates) {
      if (Number.isFinite(millis)) {
        await queueStorage.removeItem(dueKey(delivery.applicationKey, millis, delivery.id));
      }
    }
  }

  async function listAttempts(
    applicationKey: string,
    deliveryId: string,
  ): Promise<DeliveryAttempt[]> {
    const keys = (await queueStorage.getKeys(attemptsPrefix(applicationKey, deliveryId))).sort();
    const attempts = await Promise.all(keys.map((k) => queueStorage.getItem<DeliveryAttempt>(k)));
    return attempts.filter((a): a is DeliveryAttempt => a !== null);
  }

  async function deleteDeliveryCascade(delivery: Delivery): Promise<void> {
    const app = delivery.applicationKey;
    await removeDueEntry(delivery);
    for (const k of await queueStorage.getKeys(attemptsPrefix(app, delivery.id))) {
      await queueStorage.removeItem(k);
    }
    await queueStorage.removeItem(byMessageKey(app, delivery.messageId, delivery.id));
    await queueStorage.removeItem(byEndpointKey(app, delivery.endpointId, delivery.id));
    await queueStorage.removeItem(deliveryKey(app, delivery.id));
  }

  const pageSize = (limit?: number) => Math.min(Math.max(limit ?? DEFAULT_PAGE, 1), MAX_PAGE);

  /** newest-first sort; id tiebreak keeps pagination stable. */
  const byCreatedAtDesc = <T extends { createdAt?: string; id: string }>(a: T, b: T): number => {
    const diff = Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? "");
    return diff !== 0 ? diff : a.id < b.id ? 1 : -1;
  };

  function paginate<T extends { id: string }>(sorted: T[], limit?: number, beforeId?: string): T[] {
    let start = 0;
    if (beforeId) {
      const idx = sorted.findIndex((item) => item.id === beforeId);
      // A cursor that no longer exists (pruned/deleted) means the page it
      // anchored is gone — return an empty page rather than silently
      // restarting from the newest item (which would loop the caller forever).
      if (idx < 0) return [];
      start = idx + 1;
    }
    return sorted.slice(start, start + pageSize(limit));
  }

  // ------------------------------------------------------------- retention

  let pruneInFlight: Promise<void> | null = null;

  async function pruneMessagesForApp(applicationKey: string): Promise<void> {
    const rule = options.retention?.messages;
    if (!rule || (rule.keepLast === undefined && rule.maxAge === undefined)) return;
    const keys = await storage.getKeys(messagesPrefix(applicationKey));
    const messages = (await Promise.all(keys.map((k) => storage.getItem<Message>(k)))).filter(
      (m): m is Message => m !== null,
    );
    messages.sort(byCreatedAtDesc);

    const maxAgeMs = rule.maxAge !== undefined ? durationToMs(rule.maxAge) : null;
    const cutoff = maxAgeMs !== null ? now() - maxAgeMs : null;
    const pruned: Message[] = [];

    for (const [index, message] of messages.entries()) {
      const keptByCount = rule.keepLast !== undefined && index < rule.keepLast;
      const keptByAge = cutoff !== null && Date.parse(message.createdAt) >= cutoff;
      // Union of keeps: prune only when NO rule keeps it.
      if (keptByCount || keptByAge) continue;
      if (rule.keepLast === undefined && cutoff === null) continue;

      // Never prune a message the dispatcher still needs.
      const deliveryIds = (
        await queueStorage.getKeys(byMessagePrefix(applicationKey, message.id))
      ).map(lastSegment);
      const deliveries = (
        await Promise.all(
          deliveryIds.map((id) => queueStorage.getItem<Delivery>(deliveryKey(applicationKey, id))),
        )
      ).filter((d): d is Delivery => d !== null);
      if (deliveries.some((d) => !isTerminalDeliveryStatus(d.status))) continue;

      for (const delivery of deliveries) await deleteDeliveryCascade(delivery);
      if (message.idempotencyKey) {
        await storage.removeItem(idempotencyKey(applicationKey, message.idempotencyKey));
      }
      await storage.removeItem(messageKey(applicationKey, message.id));
      pruned.push(message);
    }

    if (pruned.length && after) {
      await after({ type: "message.pruned", applicationKey, messages: pruned, at: nowIso() });
    }
  }

  async function pruneAuditLog(key: string, applicationKey?: string): Promise<void> {
    const rule = options.retention?.audit;
    if (!rule || (rule.keepLast === undefined && rule.maxAge === undefined)) return;
    const log = (await storage.getItem<AuditEntry[]>(key)) ?? [];
    if (!log.length) return;
    const maxAgeMs = rule.maxAge !== undefined ? durationToMs(rule.maxAge) : null;
    const cutoff = maxAgeMs !== null ? now() - maxAgeMs : null;
    // The log is append-ordered (oldest first).
    const kept: AuditEntry[] = [];
    const removed: AuditEntry[] = [];
    for (const [index, entry] of log.entries()) {
      const fromEnd = log.length - index; // 1 = newest
      const keptByCount = rule.keepLast !== undefined && fromEnd <= rule.keepLast;
      const keptByAge = cutoff !== null && Date.parse(entry.at) >= cutoff;
      if (keptByCount || keptByAge) kept.push(entry);
      else removed.push(entry);
    }
    if (removed.length) {
      await storage.setItem(key, kept);
      if (after) {
        await after({
          type: "audit.pruned",
          ...(applicationKey ? { applicationKey } : {}),
          entries: removed,
          at: nowIso(),
        });
      }
    }
  }

  async function prunePass(): Promise<void> {
    const apps = (await storage.getItem<string[]>(applicationsKey())) ?? [];
    for (const app of apps) {
      await pruneMessagesForApp(app);
      await pruneAuditLog(auditLogKey(app), app);
    }
    await pruneAuditLog(globalAuditLogKey());
  }

  /** Serialized: a call always gets a full pass over the state it observed. */
  async function prune(): Promise<void> {
    while (pruneInFlight) await pruneInFlight;
    pruneInFlight = prunePass().finally(() => {
      pruneInFlight = null;
    });
    await pruneInFlight;
  }

  function schedulePrune(): void {
    if (!options.retention) return;
    // Off the publish hot path: fire-and-forget on a fresh task.
    const timer = setTimeout(() => {
      prune().catch((error) => {
        // eslint-disable-next-line no-console
        console.warn("[@xtandard/webhooks] retention prune failed:", error);
      });
    }, 0);
    (timer as { unref?: () => void }).unref?.();
  }

  // ------------------------------------------------------------------ core

  const core: WebhooksCore = {
    options: Object.freeze({
      storage,
      queueStorage,
      readonly,
      hooks,
      ...(options.retention ? { retention: options.retention } : {}),
      ...(options.dispatcher ? { dispatcher: options.dispatcher } : {}),
      secretRotationGrace,
      allowInsecureUrls: urlOptions.allowInsecureUrls,
      ...(options.urlPolicy ? { urlPolicy: options.urlPolicy } : {}),
      payloadLimitBytes,
      requireKnownEventTypes,
      ...(options.onDelivery ? { onDelivery: options.onDelivery } : {}),
      ...(options.onDeliveryError ? { onDeliveryError: options.onDeliveryError } : {}),
      now,
    }),

    // ------------------------------------------------------- applications

    async listApplications() {
      const keys = (await storage.getItem<string[]>(applicationsKey())) ?? [];
      const apps = await Promise.all(
        keys.map((k) => storage.getItem<Application>(applicationMetaKey(k))),
      );
      return apps.filter((a): a is Application => a !== null);
    },

    async createApplication(input, opts) {
      guard("create application");
      assertValid(validateApplication(input));
      const existing = await storage.getItem<Application>(applicationMetaKey(input.key));
      if (existing) throw new ConflictError(`Application "${input.key}" already exists.`);
      const application: Application = {
        key: input.key,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      if (before)
        await before({ type: "application.create", application, actor: opts?.actor ?? null });
      await storage.setItem(applicationMetaKey(application.key), application);
      await indexAdd(storage, applicationsKey(), application.key);
      await appendAudit({
        action: "application.create",
        by: opts?.actor ?? null,
        applicationKey: application.key,
      });
      if (after) await after({ type: "application.created", application, at: nowIso() });
      return application;
    },

    async getApplication(applicationKey) {
      return storage.getItem<Application>(applicationMetaKey(applicationKey));
    },

    async updateApplication(applicationKey, patch, opts) {
      guard("update application");
      const current = await requireApplication(applicationKey);
      const application: Application = {
        ...current,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.metadata !== undefined ? { metadata: patch.metadata } : {}),
        updatedAt: nowIso(),
      };
      assertValid(validateApplication(application));
      if (before)
        await before({ type: "application.update", application, actor: opts?.actor ?? null });
      await storage.setItem(applicationMetaKey(applicationKey), application);
      await appendAudit({
        action: "application.update",
        by: opts?.actor ?? null,
        applicationKey,
      });
      if (after) await after({ type: "application.updated", application, at: nowIso() });
      return application;
    },

    async deleteApplication(applicationKey, opts) {
      guard("delete application");
      const application = await requireApplication(applicationKey);
      if (before) {
        await before({ type: "application.delete", applicationKey, actor: opts?.actor ?? null });
      }
      for (const key of await storage.getKeys(applicationPrefix(applicationKey))) {
        await storage.removeItem(key);
      }
      if (queueStorage !== storage) {
        for (const key of await queueStorage.getKeys(applicationPrefix(applicationKey))) {
          await queueStorage.removeItem(key);
        }
      }
      await indexRemove(storage, applicationsKey(), applicationKey);
      await appendAudit(
        { action: "application.delete", by: opts?.actor ?? null, applicationKey },
        "global",
      );
      if (after) {
        await after({ type: "application.deleted", applicationKey, application, at: nowIso() });
      }
    },

    // -------------------------------------------------------- event types

    async listEventTypes() {
      const names = (await storage.getItem<string[]>(eventTypesKey())) ?? [];
      const types = await Promise.all(
        names.map((n) => storage.getItem<EventType>(eventTypeKey(n))),
      );
      return types
        .filter((t): t is EventType => t !== null)
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    async getEventType(name) {
      return storage.getItem<EventType>(eventTypeKey(name));
    },

    async upsertEventType(input, opts) {
      guard("upsert event type");
      assertValid(validateEventType(input));
      const existing = await storage.getItem<EventType>(eventTypeKey(input.name));
      const eventType: EventType = {
        ...existing,
        ...input,
        createdAt: existing?.createdAt ?? nowIso(),
        updatedAt: nowIso(),
      };
      if (before)
        await before({ type: "event-type.upsert", eventType, actor: opts?.actor ?? null });
      await storage.setItem(eventTypeKey(eventType.name), eventType);
      await indexAdd(storage, eventTypesKey(), eventType.name);
      await appendAudit(
        {
          action: existing ? "event-type.update" : "event-type.create",
          by: opts?.actor ?? null,
          subjectId: eventType.name,
        },
        "global",
      );
      if (after) await after({ type: "event-type.upserted", eventType, at: nowIso() });
      return eventType;
    },

    async deleteEventType(name, opts) {
      guard("delete event type");
      const eventType = await storage.getItem<EventType>(eventTypeKey(name));
      if (!eventType) throw new NotFoundError(`Event type "${name}" does not exist.`);
      if (before) await before({ type: "event-type.delete", name, actor: opts?.actor ?? null });
      await storage.removeItem(eventTypeKey(name));
      await indexRemove(storage, eventTypesKey(), name);
      await appendAudit(
        { action: "event-type.delete", by: opts?.actor ?? null, subjectId: name },
        "global",
      );
      if (after) await after({ type: "event-type.deleted", name, eventType, at: nowIso() });
    },

    // ---------------------------------------------------------- endpoints

    async listEndpoints(applicationKey) {
      await requireApplication(applicationKey);
      const ids = (await storage.getItem<string[]>(endpointsKey(applicationKey))) ?? [];
      const endpoints = await Promise.all(
        ids.map((id) => storage.getItem<Endpoint>(endpointKey(applicationKey, id))),
      );
      return endpoints.filter((e): e is Endpoint => e !== null);
    },

    async getEndpoint(applicationKey, endpointId) {
      return storage.getItem<Endpoint>(endpointKey(applicationKey, endpointId));
    },

    async createEndpoint(applicationKey, input, opts) {
      guard("create endpoint");
      await requireApplication(applicationKey);
      assertValid(validateEndpoint(input, urlOptions));
      const endpoint: Endpoint = {
        id: newId("ep"),
        url: input.url,
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.eventTypes !== undefined ? { eventTypes: input.eventTypes } : {}),
        ...(input.headers !== undefined ? { headers: input.headers } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        ...(input.disabled ? { disabled: true, disabledReason: "manual" as const } : {}),
        secrets: [{ secret: generateSecret(), createdAt: nowIso() }],
        createdAt: nowIso(),
        updatedAt: nowIso(),
        firstFailingAt: null,
      };
      if (before) {
        await before({
          type: "endpoint.create",
          applicationKey,
          endpoint,
          actor: opts?.actor ?? null,
        });
      }
      await storage.setItem(endpointKey(applicationKey, endpoint.id), endpoint);
      await indexAdd(storage, endpointsKey(applicationKey), endpoint.id);
      await appendAudit({
        action: "endpoint.create",
        by: opts?.actor ?? null,
        applicationKey,
        subjectId: endpoint.id,
      });
      if (after) {
        await after({ type: "endpoint.created", applicationKey, endpoint, at: nowIso() });
      }
      return endpoint;
    },

    async updateEndpoint(applicationKey, endpointId, patch, opts) {
      guard("update endpoint");
      const current = await requireEndpoint(applicationKey, endpointId);
      const endpoint: Endpoint = {
        ...current,
        ...(patch.url !== undefined ? { url: patch.url } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.eventTypes !== undefined ? { eventTypes: patch.eventTypes } : {}),
        ...(patch.headers !== undefined ? { headers: patch.headers } : {}),
        ...(patch.metadata !== undefined ? { metadata: patch.metadata } : {}),
        updatedAt: nowIso(),
      };
      assertValid(validateEndpoint(endpoint, urlOptions));
      if (before) {
        await before({
          type: "endpoint.update",
          applicationKey,
          endpoint,
          actor: opts?.actor ?? null,
        });
      }
      await storage.setItem(endpointKey(applicationKey, endpointId), endpoint);
      await appendAudit({
        action: "endpoint.update",
        by: opts?.actor ?? null,
        applicationKey,
        subjectId: endpointId,
      });
      if (after) {
        await after({ type: "endpoint.updated", applicationKey, endpoint, at: nowIso() });
      }
      return endpoint;
    },

    async deleteEndpoint(applicationKey, endpointId, opts) {
      guard("delete endpoint");
      const endpoint = await requireEndpoint(applicationKey, endpointId);
      if (before) {
        await before({
          type: "endpoint.delete",
          applicationKey,
          endpointId,
          actor: opts?.actor ?? null,
        });
      }
      await storage.removeItem(endpointKey(applicationKey, endpointId));
      await indexRemove(storage, endpointsKey(applicationKey), endpointId);
      await appendAudit({
        action: "endpoint.delete",
        by: opts?.actor ?? null,
        applicationKey,
        subjectId: endpointId,
      });
      if (after) {
        await after({ type: "endpoint.deleted", applicationKey, endpoint, at: nowIso() });
      }
    },

    async rotateSecret(applicationKey, endpointId, opts) {
      guard("rotate endpoint secret");
      const current = await requireEndpoint(applicationKey, endpointId);
      if (before) {
        await before({
          type: "endpoint.rotate-secret",
          applicationKey,
          endpointId,
          actor: opts?.actor ?? null,
        });
      }
      const graceMs = durationToMs(secretRotationGrace);
      const nowMs = now();
      const [previous, ...rest] = current.secrets;
      const secrets = [
        { secret: generateSecret(), createdAt: nowIso() },
        ...(previous ? [{ ...previous, expiresAt: new Date(nowMs + graceMs).toISOString() }] : []),
        // Lazy pruning: drop grace secrets that have already expired.
        ...rest.filter((s) => s.expiresAt && Date.parse(s.expiresAt) > nowMs),
      ];
      const endpoint: Endpoint = { ...current, secrets, updatedAt: nowIso() };
      await storage.setItem(endpointKey(applicationKey, endpointId), endpoint);
      await appendAudit({
        action: "endpoint.rotate-secret",
        by: opts?.actor ?? null,
        applicationKey,
        subjectId: endpointId,
      });
      if (after) {
        await after({ type: "endpoint.secret-rotated", applicationKey, endpoint, at: nowIso() });
      }
      return endpoint;
    },

    async getSecrets(applicationKey, endpointId) {
      const endpoint = await requireEndpoint(applicationKey, endpointId);
      return endpoint.secrets;
    },

    async enableEndpoint(applicationKey, endpointId, opts) {
      guard("enable endpoint");
      const current = await requireEndpoint(applicationKey, endpointId);
      if (before) {
        await before({
          type: "endpoint.enable",
          applicationKey,
          endpointId,
          actor: opts?.actor ?? null,
        });
      }
      const endpoint: Endpoint = { ...current, updatedAt: nowIso(), firstFailingAt: null };
      delete endpoint.disabled;
      delete endpoint.disabledReason;
      await storage.setItem(endpointKey(applicationKey, endpointId), endpoint);
      await appendAudit({
        action: "endpoint.enable",
        by: opts?.actor ?? null,
        applicationKey,
        subjectId: endpointId,
      });
      if (after) {
        await after({ type: "endpoint.enabled", applicationKey, endpoint, at: nowIso() });
      }
      return endpoint;
    },

    async disableEndpoint(applicationKey, endpointId, opts) {
      guard("disable endpoint");
      const current = await requireEndpoint(applicationKey, endpointId);
      if (before) {
        await before({
          type: "endpoint.disable",
          applicationKey,
          endpointId,
          actor: opts?.actor ?? null,
        });
      }
      const endpoint: Endpoint = {
        ...current,
        disabled: true,
        disabledReason: "manual",
        updatedAt: nowIso(),
      };
      await storage.setItem(endpointKey(applicationKey, endpointId), endpoint);
      await appendAudit({
        action: "endpoint.disable",
        by: opts?.actor ?? null,
        applicationKey,
        subjectId: endpointId,
      });
      if (after) {
        await after({ type: "endpoint.disabled", applicationKey, endpoint, at: nowIso() });
      }
      return endpoint;
    },

    // -------------------------------------------------------------- publish

    async publish(applicationKey, input, opts) {
      guard("publish message");
      await requireApplication(applicationKey);

      if (requireKnownEventTypes) {
        const known = await storage.getItem<EventType>(eventTypeKey(input.eventType));
        if (!known) {
          throw new ValidationError([
            {
              path: "message.eventType",
              message: `unknown event type "${input.eventType}" (create it first, or set requireKnownEventTypes: false)`,
            },
          ]);
        }
      }

      const serializedPayload = JSON.stringify(input.payload);
      if (serializedPayload === undefined) {
        throw new ValidationError([
          { path: "message.payload", message: "payload must be JSON-serializable" },
        ]);
      }
      const size = new TextEncoder().encode(serializedPayload).length;
      if (size > payloadLimitBytes) throw new PayloadTooLargeError(size, payloadLimitBytes);

      // The idempotency key becomes a storage key segment — reject anything that
      // could escape its namespace or traverse the filesystem (file adapter).
      if (input.idempotencyKey !== undefined) {
        const issues = validateKeySegment(input.idempotencyKey, "message.idempotencyKey");
        assertValid({ valid: issues.length === 0, errors: issues });
      }

      // Idempotency short-circuit: same key + same payload returns the original.
      if (input.idempotencyKey) {
        const existingId = await storage.getItem<string>(
          idempotencyKey(applicationKey, input.idempotencyKey),
        );
        if (existingId) {
          const existing = await storage.getItem<Message>(messageKey(applicationKey, existingId));
          if (existing) {
            // Compare canonically: some control stores (Postgres jsonb, some
            // BSON paths) reorder object keys on round-trip, so the stored
            // payload may read back with a different key order than the fresh
            // one. An order-sensitive check would flag an identical re-publish
            // as a conflict — canonical form makes the comparison uniform.
            if (canonicalStringify(existing.payload) !== canonicalStringify(input.payload)) {
              throw new IdempotencyConflictError(input.idempotencyKey);
            }
            const deliveryIds = (
              await queueStorage.getKeys(byMessagePrefix(applicationKey, existing.id))
            ).map(lastSegment);
            const deliveries = (
              await Promise.all(
                deliveryIds.map((id) =>
                  queueStorage.getItem<Delivery>(deliveryKey(applicationKey, id)),
                ),
              )
            ).filter((d): d is Delivery => d !== null);
            return { message: existing, deliveries, deduplicated: true };
          }
        }
      }

      if (before) {
        await before({
          type: "message.publish",
          applicationKey,
          eventType: input.eventType,
          payload: input.payload,
          ...(input.idempotencyKey !== undefined ? { idempotencyKey: input.idempotencyKey } : {}),
          actor: opts?.actor ?? null,
        });
      }

      const createdAt = nowIso();
      const timestamp = input.timestamp ?? createdAt;
      const message: Message = {
        id: newId("msg"),
        eventType: input.eventType,
        payload: input.payload,
        timestamp,
        ...(input.idempotencyKey !== undefined ? { idempotencyKey: input.idempotencyKey } : {}),
        // Serialized ONCE so the signed bytes are identical across every retry.
        envelope: JSON.stringify({ type: input.eventType, timestamp, data: input.payload }),
        createdAt,
      };

      // Fan out to matching enabled endpoints.
      const ids = (await storage.getItem<string[]>(endpointsKey(applicationKey))) ?? [];
      const endpoints = (
        await Promise.all(
          ids.map((id) => storage.getItem<Endpoint>(endpointKey(applicationKey, id))),
        )
      ).filter((e): e is Endpoint => e !== null);
      const matching = endpoints.filter(
        (e) =>
          !e.disabled &&
          (!e.eventTypes || e.eventTypes.length === 0 || e.eventTypes.includes(input.eventType)),
      );

      await storage.setItem(messageKey(applicationKey, message.id), message);
      if (input.idempotencyKey) {
        await storage.setItem(idempotencyKey(applicationKey, input.idempotencyKey), message.id);
      }

      const nowMs = now();
      const deliveries: Delivery[] = [];
      for (const endpoint of matching) {
        const delivery: Delivery = {
          id: newId("dlv"),
          applicationKey,
          messageId: message.id,
          endpointId: endpoint.id,
          status: "pending",
          attemptCount: 0,
          nextAttemptAt: createdAt,
          leaseUntil: null,
          createdAt,
          updatedAt: createdAt,
        };
        await writeDeliveryWithDue(delivery, nowMs);
        await queueStorage.setItem(byMessageKey(applicationKey, message.id, delivery.id), 1);
        await queueStorage.setItem(byEndpointKey(applicationKey, endpoint.id, delivery.id), 1);
        deliveries.push(delivery);
      }

      if (after) {
        await after({
          type: "message.published",
          applicationKey,
          message,
          deliveryIds: deliveries.map((d) => d.id),
          at: nowIso(),
        });
      }
      schedulePrune();
      return { message, deliveries, deduplicated: false };
    },

    // -------------------------------------------------- messages/deliveries

    async listMessages(applicationKey, opts = {}) {
      await requireApplication(applicationKey);
      const keys = await storage.getKeys(messagesPrefix(applicationKey));
      let messages = (await Promise.all(keys.map((k) => storage.getItem<Message>(k)))).filter(
        (m): m is Message => m !== null,
      );
      if (opts.eventType) messages = messages.filter((m) => m.eventType === opts.eventType);
      messages.sort(byCreatedAtDesc);
      return paginate(messages, opts.limit, opts.before);
    },

    async getMessage(applicationKey, messageId) {
      return storage.getItem<Message>(messageKey(applicationKey, messageId));
    },

    async listDeliveries(applicationKey, opts = {}) {
      await requireApplication(applicationKey);
      let ids: string[];
      if (opts.messageId) {
        ids = (await queueStorage.getKeys(byMessagePrefix(applicationKey, opts.messageId))).map(
          lastSegment,
        );
      } else if (opts.endpointId) {
        ids = (await queueStorage.getKeys(byEndpointPrefix(applicationKey, opts.endpointId))).map(
          lastSegment,
        );
      } else {
        ids = (await queueStorage.getKeys(deliveriesPrefix(applicationKey))).map(lastSegment);
      }
      let deliveries = (
        await Promise.all(
          ids.map((id) => queueStorage.getItem<Delivery>(deliveryKey(applicationKey, id))),
        )
      ).filter((d): d is Delivery => d !== null);
      if (opts.status) deliveries = deliveries.filter((d) => d.status === opts.status);
      if (opts.endpointId) deliveries = deliveries.filter((d) => d.endpointId === opts.endpointId);
      if (opts.messageId) deliveries = deliveries.filter((d) => d.messageId === opts.messageId);
      deliveries.sort(byCreatedAtDesc);
      return paginate(deliveries, opts.limit, opts.before);
    },

    async getDelivery(applicationKey, deliveryId) {
      const delivery = await queueStorage.getItem<Delivery>(
        deliveryKey(applicationKey, deliveryId),
      );
      if (!delivery) return null;
      return { delivery, attempts: await listAttempts(applicationKey, deliveryId) };
    },

    async previewDeliveryRequest(applicationKey, deliveryId) {
      const delivery = await queueStorage.getItem<Delivery>(
        deliveryKey(applicationKey, deliveryId),
      );
      if (!delivery) return null;
      const [message, endpoint] = await Promise.all([
        storage.getItem<Message>(messageKey(applicationKey, delivery.messageId)),
        storage.getItem<Endpoint>(endpointKey(applicationKey, delivery.endpointId)),
      ]);
      if (!message || !endpoint) return null;
      return buildSignedRequest({
        endpoint,
        messageId: message.id,
        body: message.envelope,
        nowMs: now(),
        userAgent: `xtandard-webhooks/${VERSION}`,
      });
    },

    async retryDelivery(applicationKey, deliveryId, opts) {
      guard("retry delivery");
      await requireApplication(applicationKey);
      const current = await queueStorage.getItem<Delivery>(deliveryKey(applicationKey, deliveryId));
      if (!current) throw new NotFoundError(`Delivery "${deliveryId}" does not exist.`);
      if (current.status !== "failed") {
        throw new ValidationError([
          {
            path: "delivery.status",
            message: `only failed (dead-letter) deliveries can be retried; this one is "${current.status}"`,
          },
        ]);
      }
      if (before) {
        await before({
          type: "delivery.retry",
          applicationKey,
          deliveryId,
          actor: opts?.actor ?? null,
        });
      }
      const nowMs = now();
      const delivery: Delivery = {
        ...current,
        status: "pending",
        nextAttemptAt: nowIso(),
        leaseUntil: null,
        pendingTrigger: "manual",
        updatedAt: nowIso(),
      };
      await writeDeliveryWithDue(delivery, nowMs);
      await appendAudit({
        action: "delivery.retry",
        by: opts?.actor ?? null,
        applicationKey,
        subjectId: deliveryId,
      });
      return delivery;
    },

    async recoverEndpoint(applicationKey, endpointId, input, opts) {
      guard("recover endpoint");
      await requireEndpoint(applicationKey, endpointId);
      const sinceMs = Date.parse(input.since);
      if (!Number.isFinite(sinceMs)) {
        throw new ValidationError([
          { path: "since", message: `"${input.since}" is not a valid timestamp` },
        ]);
      }
      if (before) {
        await before({
          type: "endpoint.recover",
          applicationKey,
          endpointId,
          since: input.since,
          actor: opts?.actor ?? null,
        });
      }
      const ids = (await queueStorage.getKeys(byEndpointPrefix(applicationKey, endpointId))).map(
        lastSegment,
      );
      const nowMs = now();
      const recovered: string[] = [];
      for (const id of ids) {
        const delivery = await queueStorage.getItem<Delivery>(deliveryKey(applicationKey, id));
        if (!delivery || delivery.status !== "failed") continue;
        if (Date.parse(delivery.createdAt) < sinceMs) continue;
        await writeDeliveryWithDue(
          {
            ...delivery,
            status: "pending",
            nextAttemptAt: nowIso(),
            leaseUntil: null,
            pendingTrigger: "manual",
            updatedAt: nowIso(),
          },
          nowMs,
        );
        recovered.push(id);
      }
      await appendAudit({
        action: "endpoint.recover",
        by: opts?.actor ?? null,
        applicationKey,
        subjectId: endpointId,
        message: `${recovered.length} deliveries re-queued since ${input.since}`,
      });
      return { deliveryIds: recovered };
    },

    async sendExample(applicationKey, endpointId, input) {
      guard("send example delivery"); // readonly must emit zero outbound traffic
      const endpoint = await requireEndpoint(applicationKey, endpointId);
      const messageId = newId("msg");
      const timestamp = nowIso();
      const body = JSON.stringify({
        type: input.eventType,
        timestamp,
        data: input.payload ?? { example: true, eventType: input.eventType },
      });
      const dispatcher = options.dispatcher;
      const outcome = await attemptDelivery({
        endpoint,
        messageId,
        body,
        ...(dispatcher?.timeoutMs !== undefined ? { timeoutMs: dispatcher.timeoutMs } : {}),
        ...(dispatcher?.responseBodyLimit !== undefined
          ? { responseBodyLimit: dispatcher.responseBodyLimit }
          : {}),
        ...(dispatcher?.fetch ? { fetch: dispatcher.fetch } : {}),
        ...(dispatcher?.userAgent !== undefined ? { userAgent: dispatcher.userAgent } : {}),
        nowMs: now(),
      });
      if (options.onDelivery) {
        emitDelivery(
          options.onDelivery,
          {
            applicationKey,
            endpointId,
            messageId,
            deliveryId: messageId, // no persisted delivery for a test send
            eventType: input.eventType,
            attemptNumber: 1,
            ok: outcome.ok,
            terminal: true,
            ...(outcome.httpStatus !== undefined ? { httpStatus: outcome.httpStatus } : {}),
            durationMs: outcome.durationMs,
            trigger: "test",
            at: outcome.at,
          },
          options.onDeliveryError,
        );
      }
      return { outcome, body, messageId };
    },

    // ---------------------------------------------------------------- audit

    async listAudit(applicationKey) {
      if (applicationKey) {
        const log = (await storage.getItem<AuditEntry[]>(auditLogKey(applicationKey))) ?? [];
        return [...log].reverse();
      }
      const apps = (await storage.getItem<string[]>(applicationsKey())) ?? [];
      const logs = await Promise.all([
        storage.getItem<AuditEntry[]>(globalAuditLogKey()),
        ...apps.map((app) => storage.getItem<AuditEntry[]>(auditLogKey(app))),
      ]);
      const merged = logs.flatMap((log) => log ?? []);
      merged.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
      return merged;
    },

    prune,

    // ------------------------------------------------- dispatcher internals

    async claimDueDeliveries(input) {
      const nowMs = now();
      const nowStr = new Date(nowMs).toISOString();
      if (hasDeliveryQueue(queueStorage)) {
        return queueStorage.claimDue({ now: nowStr, limit: input.limit, leaseMs: input.leaseMs });
      }

      // Generic fallback: scan each app's due index (13-digit zero-padded keys
      // sort chronologically), claim with CAS when the storage supports it.
      const apps = (await storage.getItem<string[]>(applicationsKey())) ?? [];
      const claimed: Delivery[] = [];
      const cas = isCompareAndSwap(queueStorage) ? queueStorage : null;

      for (const app of apps) {
        if (claimed.length >= input.limit) break;
        const dueKeys = (await queueStorage.getKeys(`whk/${app}/due/`)).sort();
        for (const key of dueKeys) {
          if (claimed.length >= input.limit) break;
          const suffix = lastSegment(key);
          const sep = suffix.indexOf("~");
          if (sep === -1) continue;
          const dueAt = Number(suffix.slice(0, sep));
          if (!Number.isFinite(dueAt) || dueAt > nowMs) break; // sorted — the rest are later
          const entry = await queueStorage.getItem<DueEntry>(key);
          if (!entry) continue;
          const dKey = deliveryKey(entry.app, entry.deliveryId);
          const delivery = await queueStorage.getItem<Delivery>(dKey);
          if (!delivery || isTerminalDeliveryStatus(delivery.status)) {
            await queueStorage.removeItem(key); // orphan sweep
            continue;
          }
          const leaseExpired =
            delivery.status === "delivering" &&
            (!delivery.leaseUntil || Date.parse(delivery.leaseUntil) <= nowMs);
          if (delivery.status !== "pending" && !leaseExpired) continue;

          const next: Delivery = {
            ...delivery,
            status: "delivering",
            leaseUntil: new Date(nowMs + input.leaseMs).toISOString(),
            updatedAt: nowStr,
          };
          if (cas) {
            const won = await cas.compareAndSwap({ key: dKey, expected: delivery, next });
            if (!won) continue; // another dispatcher claimed it first
          } else {
            await queueStorage.setItem(dKey, next);
          }
          await queueStorage.removeItem(key);
          await queueStorage.setItem<DueEntry>(
            dueKey(entry.app, nowMs + input.leaseMs, entry.deliveryId),
            entry,
          );
          claimed.push(next);
        }
      }
      return claimed;
    },

    async recordAttempt(input) {
      const { delivery, outcome } = input;
      const app = delivery.applicationKey;
      const attemptNumber = delivery.attemptCount + 1;
      const attempt: DeliveryAttempt = {
        id: newId("atp"),
        deliveryId: delivery.id,
        attemptNumber,
        at: outcome.at,
        durationMs: outcome.durationMs,
        ok: outcome.ok,
        ...(outcome.httpStatus !== undefined ? { httpStatus: outcome.httpStatus } : {}),
        ...(outcome.error !== undefined ? { error: outcome.error } : {}),
        ...(outcome.responseBody !== undefined ? { responseBody: outcome.responseBody } : {}),
        trigger: input.trigger,
      };
      await queueStorage.setItem(attemptKey(app, delivery.id, attemptNumber), attempt);

      await removeDueEntry(delivery);

      // The one-shot trigger hint has served its purpose.
      const base: Delivery = { ...delivery };
      delete base.pendingTrigger;

      let next: Delivery;
      if (outcome.ok) {
        next = {
          ...base,
          status: "succeeded",
          attemptCount: attemptNumber,
          nextAttemptAt: null,
          leaseUntil: null,
          updatedAt: nowIso(),
        };
        await queueStorage.setItem(deliveryKey(app, delivery.id), next);
        if (after) {
          await after({
            type: "delivery.succeeded",
            applicationKey: app,
            delivery: next,
            attempt,
            at: nowIso(),
          });
        }
      } else if (input.nextAttemptAt) {
        next = {
          ...base,
          status: "pending",
          attemptCount: attemptNumber,
          nextAttemptAt: input.nextAttemptAt,
          leaseUntil: null,
          updatedAt: nowIso(),
        };
        await writeDeliveryWithDue(next, Date.parse(input.nextAttemptAt));
      } else {
        // Exhausted — dead-letter.
        next = {
          ...base,
          status: "failed",
          attemptCount: attemptNumber,
          nextAttemptAt: null,
          leaseUntil: null,
          updatedAt: nowIso(),
        };
        await queueStorage.setItem(deliveryKey(app, delivery.id), next);
        if (after) {
          await after({
            type: "delivery.exhausted",
            applicationKey: app,
            delivery: next,
            attempts: await listAttempts(app, delivery.id),
            at: nowIso(),
          });
        }
      }

      if (options.onDelivery) {
        emitDelivery(
          options.onDelivery,
          {
            applicationKey: app,
            endpointId: delivery.endpointId,
            messageId: delivery.messageId,
            deliveryId: delivery.id,
            eventType: input.eventType,
            attemptNumber,
            ok: outcome.ok,
            terminal: isTerminalDeliveryStatus(next.status),
            ...(outcome.httpStatus !== undefined ? { httpStatus: outcome.httpStatus } : {}),
            durationMs: outcome.durationMs,
            trigger: input.trigger,
            at: outcome.at,
          },
          options.onDeliveryError,
        );
      }
      return next;
    },

    async noteEndpointOutcome(applicationKey, endpointId, ok, policy) {
      const key = endpointKey(applicationKey, endpointId);
      const failingForDays = policy === false ? undefined : (policy?.failingForDays ?? 5);

      // Compute the failure-accounting delta from the *latest* endpoint record,
      // and commit it without clobbering a concurrent control-plane write
      // (enable/disable/edit runs in the web process while the dispatcher runs
      // here). With CAS storage this is a retry loop; without it we re-read
      // immediately before writing to shrink — not eliminate — the window (the
      // single-dispatcher assumption already applies to non-CAS backends).
      const plan = (current: Endpoint): { next: Endpoint; disabled: boolean } | null => {
        if (ok) {
          if (!current.firstFailingAt) return null; // nothing to clear
          return { next: { ...current, firstFailingAt: null }, disabled: false };
        }
        const firstFailingAt = current.firstFailingAt ?? nowIso();
        let next: Endpoint = { ...current, firstFailingAt };
        const shouldDisable =
          failingForDays !== undefined &&
          !current.disabled &&
          now() - Date.parse(firstFailingAt) > failingForDays * 86_400_000;
        if (shouldDisable) {
          next = { ...next, disabled: true, disabledReason: "auto", updatedAt: nowIso() };
        }
        return { next, disabled: shouldDisable };
      };

      const cas = isCompareAndSwap(storage) ? storage : null;
      let committed: { next: Endpoint; disabled: boolean } | null = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const current = await storage.getItem<Endpoint>(key);
        if (!current) return null;
        const planned = plan(current);
        if (!planned) return null;
        if (cas) {
          const won = await cas.compareAndSwap({ key, expected: current, next: planned.next });
          if (!won) continue; // a concurrent write landed — re-read and re-plan
        } else {
          await storage.setItem(key, planned.next);
        }
        committed = planned;
        break;
      }
      if (!committed) return null;

      const updated = committed.next;
      const shouldDisable = committed.disabled;

      if (shouldDisable) {
        await appendAudit({
          action: "endpoint.disable",
          applicationKey,
          subjectId: endpointId,
          message: `auto-disabled: failing since ${updated.firstFailingAt}`,
        });
        if (after) {
          await after({
            type: "endpoint.auto-disabled",
            applicationKey,
            endpoint: updated,
            at: nowIso(),
          });
        }
        return updated;
      }
      return null;
    },
  };

  return core;
}
