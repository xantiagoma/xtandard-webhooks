/**
 * `xtandard-webhooks` CLI. Operates on the same storage your app/panel uses
 * (configured via the `STORAGE_DRIVER` / `QUEUE_STORAGE_DRIVER` env vars,
 * mirroring the standalone app), so it slots into shell, CI, and split-worker
 * workflows.
 *
 * Commands: `serve` (panel + dispatcher, no Docker), `dispatch` (dispatcher
 * ONLY — the split-worker mode), `init`, `list-apps`, `list-endpoints`,
 * `publish`, `retry`, `verify`, `sign` (build a signed request — the signature
 * playground), and `listen` (a local inspecting receiver — the webhook.site
 * you run yourself).
 *
 * @module
 */

import {
  buildAuthFromEnv,
  describeStorage as kitDescribeStorage,
  env,
  isMainModule,
  parseArgs,
  pkgVersion as kitPkgVersion,
  serve,
  startServer,
  storageFromEnv,
  type StorageRegistry,
  type StorageRole,
} from "@xtandard/kit/cli";
import { WEBHOOKS_ACTIONS, type WebhooksAction } from "./authorization/contract.ts";
import {
  createWebhooksCore,
  type RetentionOptions,
  type RetentionRule,
  type WebhooksCore,
} from "./core.ts";
import type { DispatcherOptions } from "./dispatcher.ts";
import { durationToMs, parseDurationList } from "./duration.ts";
import type { JsonValue, WebhookDuration } from "./schema.ts";
import type { WebhooksStorage } from "./storage/contract.ts";

/** The two storage roles: control plane (`STORAGE`) and delivery queue (`QUEUE`). */
type Role = "STORAGE" | "QUEUE";

/** The drivers the CLI accepts (an unknown `STORAGE_DRIVER` is an error). */
const DRIVERS = ["memory", "file", "redis", "postgres", "mongodb", "sqlite", "libsql"] as const;

/**
 * A storage role with its persisted defaults (ADR 0005): the role name in
 * lower case is part of every default location, e.g. `xtandard_webhooks_storage`.
 * The driver variables are `STORAGE_DRIVER` and `QUEUE_STORAGE_DRIVER`.
 */
const storageRole = (role: Role): StorageRole => {
  const r = role.toLowerCase();
  return {
    name: role,
    defaults: {
      prefix: `xtandard:webhooks:${r}`,
      pgTable: `xtandard_webhooks_${r}`,
      mongoDb: "xtandard_webhooks",
      mongoCollection: `webhooks_${r}`,
      sqlitePath: `./.webhooks/${r}.sqlite`,
      libsqlUrl: `file:./.webhooks/${r}.db`,
      fileDir: `./.webhooks/${r}`,
    },
  };
};

/**
 * The webhooks storage factories, so every CLI store carries the product
 * defaults (the `xtandard_webhooks` sqlite/libsql table) and capabilities
 * (`claimDue` on memory and redis). Each driver module loads on first use.
 */
const STORAGE_DRIVERS: StorageRegistry<WebhooksStorage> = {
  memory: async () => (await import("./storage/memory.ts")).createMemoryStorage(),
  file: async (c) => (await import("./storage/file.ts")).createFileStorage({ dir: c.fileDir! }),
  redis: async (c) =>
    (await import("./storage/redis.ts")).createRedisStorage({
      url: c.redisUrl,
      ...(c.prefix ? { prefix: c.prefix } : {}),
    }),
  postgres: async (c) =>
    (await import("./storage/postgres.ts")).createPostgresStorage({
      connectionString: c.postgresUrl,
      ...(c.pgTable ? { table: c.pgTable } : {}),
    }),
  mongodb: async (c) =>
    (await import("./storage/mongodb.ts")).createMongoStorage({
      url: c.mongoUrl,
      ...(c.mongoDb ? { dbName: c.mongoDb } : {}),
      ...(c.mongoCollection ? { collectionName: c.mongoCollection } : {}),
    }),
  // Requires running the CLI under Bun (`bunx xtandard-webhooks …`).
  sqlite: async (c) =>
    (await import("./storage/sqlite.ts")).createSqliteStorage({
      ...(c.sqlitePath ? { path: c.sqlitePath } : {}),
      ...(c.sqliteTable ? { table: c.sqliteTable } : {}),
    }),
  libsql: async (c) =>
    (await import("./storage/libsql.ts")).createLibsqlStorage({
      ...(c.libsqlUrl ? { url: c.libsqlUrl } : {}),
      ...(c.libsqlAuthToken ? { authToken: c.libsqlAuthToken } : {}),
      ...(c.sqliteTable ? { table: c.sqliteTable } : {}),
    }),
};

/**
 * Parse a duration env like `"30d"`, `"34h"`, `"90m"`, `"10s"` into a
 * {@link WebhookDuration}, warning and ignoring malformed values.
 */
function parseDurationEnv(name: string): WebhookDuration | undefined {
  const raw = env(name);
  if (!raw) return undefined;
  try {
    durationToMs(raw as WebhookDuration); // validate eagerly
    return raw as WebhookDuration;
  } catch {
    process.stderr.write(
      `[xtandard/webhooks] Ignoring ${name}="${raw}" — expected <number><unit> with unit ms|s|m|h|d (e.g. 34h, 30d).\n`,
    );
    return undefined;
  }
}

/**
 * Retention from env: `MESSAGE_KEEP_LAST` / `MESSAGE_MAX_AGE` and
 * `AUDIT_KEEP_LAST` / `AUDIT_MAX_AGE`. Returns undefined when none are set.
 */
function retentionFromEnv(): RetentionOptions | undefined {
  const rule = (keepVar: string, ageVar: string): RetentionRule | undefined => {
    const keepRaw = env(keepVar);
    const keepLast = keepRaw && /^\d+$/.test(keepRaw) ? Number(keepRaw) : undefined;
    if (keepRaw && keepLast === undefined) {
      process.stderr.write(
        `[xtandard/webhooks] Ignoring ${keepVar}="${keepRaw}" — expected a number.\n`,
      );
    }
    const maxAge = parseDurationEnv(ageVar);
    if (keepLast === undefined && !maxAge) return undefined;
    return {
      ...(keepLast !== undefined ? { keepLast } : {}),
      ...(maxAge !== undefined ? { maxAge } : {}),
    };
  };
  const messages = rule("MESSAGE_KEEP_LAST", "MESSAGE_MAX_AGE");
  const audit = rule("AUDIT_KEEP_LAST", "AUDIT_MAX_AGE");
  if (!messages && !audit) return undefined;
  return {
    ...(messages ? { messages } : {}),
    ...(audit ? { audit } : {}),
  };
}

/** Dispatcher config from env: `RETRY_SCHEDULE` (comma list, e.g. `0s,5s,5m`). */
function dispatcherOptionsFromEnv(): DispatcherOptions {
  const raw = env("RETRY_SCHEDULE");
  if (!raw) return {};
  try {
    return { retrySchedule: parseDurationList(raw) };
  } catch {
    process.stderr.write(
      `[xtandard/webhooks] Ignoring RETRY_SCHEDULE="${raw}" — expected a comma list of durations (e.g. "0s,5s,5m,30m,2h,5h,10h").\n`,
    );
    return {};
  }
}

/** Whether the in-process dispatcher is enabled (`DISPATCHER=0|false` disables). */
function dispatcherEnabled(): boolean {
  const raw = env("DISPATCHER");
  if (!raw) return true;
  return !(raw === "0" || raw.toLowerCase() === "false");
}

/**
 * Build one storage role from env. `STORAGE` holds the control plane
 * (applications, event types, endpoints, messages, audit); `QUEUE` holds
 * deliveries + the due index and defaults to the same store (see
 * {@link buildQueueStorage}).
 */
async function buildStorage(role: Role): Promise<WebhooksStorage> {
  return storageFromEnv({ role: storageRole(role), drivers: STORAGE_DRIVERS, allowed: DRIVERS });
}

/**
 * The queue store, or `undefined` to share the control-plane store. Only built
 * when `QUEUE_STORAGE_DRIVER` is explicitly set (split-plane deployments:
 * control data in Postgres, queue in Redis).
 */
async function buildQueueStorage(): Promise<WebhooksStorage | undefined> {
  if (!env("QUEUE_STORAGE_DRIVER")) return undefined;
  return buildStorage("QUEUE");
}

/**
 * A human-readable, log-safe description of where a storage role persists data
 * — for the `serve`/`dispatch` startup banner. File/SQLite paths are resolved
 * to absolute so "where did my webhooks go?" is obvious; connection-string
 * drivers print only the driver name (never the URL, which may carry
 * credentials).
 */
async function describeStorage(role: Role): Promise<string> {
  return kitDescribeStorage(storageRole(role), { allowed: DRIVERS });
}

/**
 * The auth + authorization providers from env (mirrors the standalone app):
 * `AUTH_MODE=none` (default) or `basic`; anything else is an error.
 */
async function buildAuth() {
  const { DEFAULT_ROLE_POLICY } = await import("./authorization/roles.ts");
  return buildAuthFromEnv<WebhooksAction>({
    realm: "xtandard-webhooks",
    roles: { policy: DEFAULT_ROLE_POLICY, actions: WEBHOOKS_ACTIONS },
    name: "xtandard/webhooks",
  });
}

type FetchHandler = (request: Request) => Response | Promise<Response>;

/** Verification outcome shown by `listen` for each captured request. */
export type InboundVerification =
  | { state: "unchecked" } // no --secret given
  | { state: "ok" }
  | { state: "failed"; reason: string };

/**
 * Format one captured inbound webhook for the terminal — the `listen` command's
 * pretty-printer. Pure and side-effect-free so it can be unit-tested.
 */
export function formatInboundWebhook(input: {
  index: number;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
  verification: InboundVerification;
  at: string;
}): string {
  const wh = (name: string) => input.headers[name] ?? input.headers[name.toLowerCase()] ?? "—";
  const badge =
    input.verification.state === "ok"
      ? "signature: VERIFIED"
      : input.verification.state === "failed"
        ? `signature: FAILED (${input.verification.reason})`
        : "signature: not checked (pass --secret to verify)";
  let prettyBody = input.body;
  try {
    prettyBody = JSON.stringify(JSON.parse(input.body), null, 2);
  } catch {
    // leave non-JSON bodies as-is
  }
  return [
    `\n── #${input.index}  ${input.method} ${input.path}  ${input.at} ──`,
    `webhook-id:        ${wh("webhook-id")}`,
    `webhook-timestamp: ${wh("webhook-timestamp")}`,
    `webhook-signature: ${wh("webhook-signature")}`,
    badge,
    "body:",
    prettyBody,
    "",
  ].join("\n");
}

/** A core over the env-configured storage (dispatcher NOT started). */
async function makeCore(): Promise<WebhooksCore> {
  const [storage, queueStorage] = await Promise.all([buildStorage("STORAGE"), buildQueueStorage()]);
  const retention = retentionFromEnv();
  return createWebhooksCore({
    storage,
    ...(queueStorage ? { queueStorage } : {}),
    ...(retention ? { retention } : {}),
    dispatcher: dispatcherOptionsFromEnv(),
  });
}

/** This package's version, from `../package.json` (right for both `dist/` and `src/`). */
const pkgVersion = (): Promise<string> => kitPkgVersion(import.meta.url);

function helpText(version: string): string {
  return `xtandard-webhooks v${version} — self-hosted, Standard Webhooks-compliant outbound webhook control plane

Usage:
  xtandard-webhooks <command> [options]     # the binary, after: npm i -g @xtandard/webhooks
  npx @xtandard/webhooks <command>          # without installing (or: bunx @xtandard/webhooks …)

Commands:
  serve [--port <n>]            Run the admin panel + API + delivery dispatcher (no Docker).
  dispatch [--port <n>]         Run the delivery dispatcher ONLY (split-worker mode).
                                With --port/$PORT: also serves GET /healthcheck.
  init [--app <key>]            Create an application + an example event type.
  list-apps                     List applications.
  list-endpoints --app <key>    List an application's endpoints.
  publish --app <key> --type <event> --data '<json>' [--idempotency-key <k>]
                                Publish a message (ingest from shell/CI).
  retry --app <key> --delivery <id>
                                Re-queue a dead-lettered delivery.
  verify --secret <whsec_…> --payload-file <path> --headers-file <path>
                                Verify a captured webhook (receiver-side debugging):
                                reads the raw payload + a JSON headers object,
                                prints the envelope, exits 1 on failure.
  sign --secret <whsec_…> --data '<json>' [--id <msg_…>] [--timestamp <unix>] [--url <target>]
                                Build a signed Standard Webhooks request (the
                                signature playground): prints the headers + body,
                                and a ready-to-run curl when --url is given.
  listen [--port <n>] [--secret <whsec_…>] [--status <code>]
                                Run a local inspecting receiver (the webhook.site
                                you host yourself): pretty-prints every incoming
                                webhook; with --secret, verifies the signature.

Global options:
  -h, --help                    Show this help.
  -v, --version                 Print the version.

\`serve\` / \`dispatch\` options:
  --port <n>                    Port to listen on (default: $PORT or 3000).

Environment variables
  Storage  (control plane STORAGE_; delivery queue QUEUE_, defaults to the same store):
    STORAGE_DRIVER, QUEUE_STORAGE_DRIVER
                                memory | file | redis | postgres | mongodb | sqlite | libsql
                                (CLI default: file · Docker default: memory)
    REDIS_URL                   redis://localhost:6379                     (driver: redis)
    STORAGE_PREFIX, QUEUE_PREFIX   key namespace                           (driver: redis)
    DATABASE_URL | POSTGRES_URL  postgres://…                              (driver: postgres)
    STORAGE_PG_TABLE, QUEUE_PG_TABLE                                       (driver: postgres)
    MONGO_URL, MONGO_DB, STORAGE_MONGO_COLLECTION, QUEUE_MONGO_COLLECTION  (driver: mongodb)
    STORAGE_FILE_DIR, QUEUE_FILE_DIR   default ./.webhooks/{storage,queue} (driver: file)
    STORAGE_SQLITE_PATH, QUEUE_SQLITE_PATH                                 (driver: sqlite, Bun only)
    LIBSQL_URL | STORAGE_LIBSQL_URL, QUEUE_LIBSQL_URL, LIBSQL_AUTH_TOKEN   (driver: libsql)

  Server  (\`serve\` / standalone):
    PORT            3000        Port to listen on (or --port).
    BASE_PATH       ""          URL prefix, e.g. "/webhooks".
    TITLE                       Navbar wordmark.
    LOGO_URL                    Logo image URL.
    READONLY        1|true      Block all mutating operations.
    AUTH_MODE       none|basic  Authentication mode (default none; any other value is rejected).
    AUTH_USERNAME   admin       Username for basic auth.
    AUTH_PASSWORD_HASH          scrypt hash (preferred; see docs/AUTH.md).
    AUTH_PASSWORD               Plaintext password (dev only).
    PORTAL_SECRET               Enables portal-token access (whpt_… bearer tokens).

  Delivery  (\`serve\` / \`dispatch\` / standalone):
    DISPATCHER      1           0|false disables the in-process dispatcher
                                (host publishes only; a split worker delivers).
    RETRY_SCHEDULE              Comma list of retry delays, e.g. "0s,5s,5m,30m,2h,5h,10h".

  Retention  (pruned opportunistically after publishes; kept if EITHER rule keeps it;
              messages with a non-terminal delivery are always kept):
    MESSAGE_KEEP_LAST           Keep at most the N most recent messages per app.
    MESSAGE_MAX_AGE     30d     Keep messages newer than this (ms|s|m|h|d, e.g. 34h).
    AUDIT_KEEP_LAST             Keep at most the N most recent audit entries.
    AUDIT_MAX_AGE       90d     Keep audit entries newer than this.

Examples:
  # Quick local panel (file storage, no auth):
  npx @xtandard/webhooks serve --port 3004

  # Production-ish: Redis storage + basic auth:
  PORT=4000 AUTH_MODE=basic AUTH_USERNAME=admin AUTH_PASSWORD=secret \\
    STORAGE_DRIVER=redis REDIS_URL=redis://localhost:6379 \\
    npx @xtandard/webhooks serve

  # Split planes: Postgres control plane + Redis queue:
  STORAGE_DRIVER=postgres DATABASE_URL=postgres://localhost:5432/webhooks \\
    QUEUE_STORAGE_DRIVER=redis REDIS_URL=redis://localhost:6379 \\
    npx @xtandard/webhooks serve

  # Split worker: the web process publishes only (DISPATCHER=0); this delivers:
  STORAGE_DRIVER=redis REDIS_URL=redis://localhost:6379 \\
    npx @xtandard/webhooks dispatch

  # Publish from CI:
  xtandard-webhooks publish --app acme --type invoice.paid --data '{"invoiceId":"inv_1"}'

  # Debug a captured webhook on the receiving side:
  xtandard-webhooks verify --secret whsec_… --payload-file body.json --headers-file headers.json

  # Inspect webhooks locally (point an endpoint at http://localhost:4000):
  xtandard-webhooks listen --port 4000 --secret whsec_…

  # Build + fire a signed request by hand (the signature playground):
  xtandard-webhooks sign --secret whsec_… --data '{"hi":1}' --url http://localhost:4000

Receivers verify with @xtandard/webhooks/receiver — or any Standard Webhooks
library. Docs: https://github.com/xantiagoma/xtandard-webhooks
`;
}

/** Entry point. Returns the process exit code. */
export async function run(argv: string[]): Promise<number> {
  const { _, flags } = parseArgs(argv);
  const command = _[0];

  // `--version` (bare) / `-v` / `version` → print version. Only the boolean form
  // is treated as "print version" so a future `--version <value>` flag can coexist.
  if (flags.version === true || argv.includes("-v") || command === "version") {
    process.stdout.write(`${await pkgVersion()}\n`);
    return 0;
  }

  const wantsHelp = Boolean(flags.help) || argv.includes("-h") || command === "help";
  if (!command || wantsHelp) {
    process.stdout.write(helpText(await pkgVersion()));
    // Explicit help request → success; bare invocation with no command → usage error.
    return wantsHelp ? 0 : 1;
  }

  try {
    switch (command) {
      case "init": {
        const core = await makeCore();
        const app = typeof flags.app === "string" ? flags.app : env("APP", "default");
        const existing = await core.getApplication(app);
        if (!existing) await core.createApplication({ key: app });
        await core.upsertEventType({
          name: "example.ping",
          description: "Example event type created by `xtandard-webhooks init`.",
        });
        process.stdout.write(
          `Initialized application "${app}" with event type "example.ping".\n` +
            `Add endpoints in the panel (xtandard-webhooks serve), then:\n` +
            `  xtandard-webhooks publish --app ${app} --type example.ping --data '{"hello":"world"}'\n`,
        );
        return 0;
      }
      case "list-apps": {
        const core = await makeCore();
        const apps = await core.listApplications();
        if (apps.length === 0) process.stdout.write("No applications.\n");
        for (const app of apps) {
          process.stdout.write(`${app.key}${app.name ? `  ${app.name}` : ""}\n`);
        }
        return 0;
      }
      case "list-endpoints": {
        if (typeof flags.app !== "string") {
          process.stderr.write("Usage: xtandard-webhooks list-endpoints --app <key>\n");
          return 1;
        }
        const core = await makeCore();
        const endpoints = await core.listEndpoints(flags.app);
        if (endpoints.length === 0) process.stdout.write("No endpoints.\n");
        for (const endpoint of endpoints) {
          const subscriptions = endpoint.eventTypes?.length
            ? endpoint.eventTypes.join(",")
            : "all events";
          process.stdout.write(
            `${endpoint.disabled ? "○" : "●"} ${endpoint.id}  ${endpoint.url}  [${subscriptions}]\n`,
          );
        }
        return 0;
      }
      case "publish": {
        if (typeof flags.app !== "string" || typeof flags.type !== "string") {
          process.stderr.write(
            "Usage: xtandard-webhooks publish --app <key> --type <event> --data '<json>' [--idempotency-key <k>]\n",
          );
          return 1;
        }
        let payload: JsonValue = {};
        if (typeof flags.data === "string") {
          try {
            payload = JSON.parse(flags.data) as JsonValue;
          } catch {
            process.stderr.write("Invalid --data JSON.\n");
            return 1;
          }
        }
        const core = await makeCore();
        const idempotencyKey =
          typeof flags["idempotency-key"] === "string" ? flags["idempotency-key"] : undefined;
        const result = await core.publish(flags.app, {
          eventType: flags.type,
          payload,
          ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
        });
        process.stdout.write(
          `${result.deduplicated ? "Deduplicated" : "Published"} ${result.message.id} → ` +
            `${result.deliveries.length} deliver${result.deliveries.length === 1 ? "y" : "ies"} queued.\n`,
        );
        return 0;
      }
      case "retry": {
        if (typeof flags.app !== "string" || typeof flags.delivery !== "string") {
          process.stderr.write("Usage: xtandard-webhooks retry --app <key> --delivery <id>\n");
          return 1;
        }
        const core = await makeCore();
        const delivery = await core.retryDelivery(flags.app, flags.delivery);
        process.stdout.write(`Re-queued delivery ${delivery.id} (status: ${delivery.status}).\n`);
        return 0;
      }
      case "verify": {
        if (
          typeof flags.secret !== "string" ||
          typeof flags["payload-file"] !== "string" ||
          typeof flags["headers-file"] !== "string"
        ) {
          process.stderr.write(
            "Usage: xtandard-webhooks verify --secret <whsec_…> --payload-file <path> --headers-file <path>\n",
          );
          return 1;
        }
        const { readFile } = await import("node:fs/promises");
        const payload = await readFile(flags["payload-file"], "utf8");
        let headers: Record<string, string>;
        try {
          headers = JSON.parse(await readFile(flags["headers-file"], "utf8")) as Record<
            string,
            string
          >;
        } catch {
          process.stderr.write("Invalid --headers-file: expected a JSON object of headers.\n");
          return 1;
        }
        const { verify, WebhookVerificationError } = await import("./signing.ts");
        try {
          const envelope = await verify({ payload, headers, secret: flags.secret });
          process.stdout.write(`Signature OK.\n${JSON.stringify(envelope, null, 2)}\n`);
          return 0;
        } catch (err) {
          if (err instanceof WebhookVerificationError) {
            process.stderr.write(`Verification FAILED: ${err.message}\n`);
            return 1;
          }
          throw err;
        }
      }
      case "sign": {
        // The signature playground: build a fully signed Standard Webhooks
        // request from a secret + payload, so you can curl it at a receiver or
        // paste it into https://www.standardwebhooks.com/simulate.
        if (typeof flags.secret !== "string" || typeof flags.data !== "string") {
          process.stderr.write(
            "Usage: xtandard-webhooks sign --secret <whsec_…> --data '<json>' [--id <msg_…>] [--timestamp <unix-seconds>] [--url <post-target>]\n",
          );
          return 1;
        }
        // Validate the payload is JSON, but sign the exact bytes given.
        try {
          JSON.parse(flags.data);
        } catch {
          process.stderr.write("Invalid --data: expected a JSON string.\n");
          return 1;
        }
        const { newId } = await import("./id.ts");
        const { sign } = await import("./signing.ts");
        const id = typeof flags.id === "string" ? flags.id : newId("msg");
        const timestamp =
          typeof flags.timestamp === "string"
            ? Number(flags.timestamp)
            : Math.floor(Date.now() / 1000);
        const signature = await sign(flags.secret, id, timestamp, flags.data);
        const headerLines = [
          `webhook-id: ${id}`,
          `webhook-timestamp: ${timestamp}`,
          `webhook-signature: ${signature}`,
        ];
        process.stdout.write(`${headerLines.join("\n")}\n\n${flags.data}\n`);
        if (typeof flags.url === "string") {
          const curl = [
            `curl -X POST ${flags.url} \\`,
            `  -H 'content-type: application/json' \\`,
            `  -H 'webhook-id: ${id}' \\`,
            `  -H 'webhook-timestamp: ${timestamp}' \\`,
            `  -H 'webhook-signature: ${signature}' \\`,
            `  -d '${flags.data.replace(/'/g, "'\\''")}'`,
          ].join("\n");
          process.stdout.write(`\n${curl}\n`);
        }
        return 0;
      }
      case "listen": {
        // A local inspecting receiver — the webhook.site you run yourself.
        // Prints every incoming request; with --secret it verifies the
        // signature and shows a VERIFIED/FAILED badge.
        const port = Number((flags.port as string) || env("PORT", "4000"));
        const secret = typeof flags.secret === "string" ? flags.secret : undefined;
        const status = typeof flags.status === "string" ? Number(flags.status) : 200;
        const { verify, WebhookVerificationError } = await import("./signing.ts");
        let count = 0;

        await startServer(port, async (request) => {
          const url = new URL(request.url);
          if (url.pathname === "/healthcheck") {
            return new Response(JSON.stringify({ status: "ok" }), {
              headers: { "content-type": "application/json" },
            });
          }
          const body = await request.text();
          const headers: Record<string, string> = {};
          request.headers.forEach((value, key) => {
            headers[key] = value;
          });
          let verification: InboundVerification = { state: "unchecked" };
          if (secret) {
            try {
              await verify({ payload: body, headers, secret });
              verification = { state: "ok" };
            } catch (err) {
              verification = {
                state: "failed",
                reason: err instanceof WebhookVerificationError ? err.message : String(err),
              };
            }
          }
          count += 1;
          process.stdout.write(
            formatInboundWebhook({
              index: count,
              method: request.method,
              path: url.pathname,
              headers,
              body,
              verification,
              at: new Date().toISOString(),
            }),
          );
          // A signature failure answers 401 so senders exercise their retry path;
          // otherwise echo the configured status (default 200).
          if (verification.state === "failed")
            return new Response("invalid signature", { status: 401 });
          return new Response("ok", { status });
        });
        process.stdout.write(
          `[xtandard/webhooks] listening for webhooks on http://localhost:${port}` +
            `${secret ? " (verifying signatures)" : " (not verifying — pass --secret)"}\n`,
        );
        return await new Promise<number>(() => {});
      }
      case "dispatch": {
        const core = await makeCore();
        const { createDispatcher } = await import("./dispatcher.ts");
        const dispatcher = createDispatcher(core); // merges core.options.dispatcher (RETRY_SCHEDULE)
        dispatcher.start();

        const [storageDesc, queueDesc] = await Promise.all([
          describeStorage("STORAGE"),
          env("QUEUE_STORAGE_DRIVER") ? describeStorage("QUEUE") : Promise.resolve("(same store)"),
        ]);
        process.stdout.write(`[xtandard/webhooks] storage: ${storageDesc}\n`);
        process.stdout.write(`[xtandard/webhooks] queue:   ${queueDesc}\n`);

        // Optional minimal healthcheck server — only when a port was asked for.
        const portRaw = typeof flags.port === "string" ? flags.port : env("PORT");
        if (portRaw) {
          const port = Number(portRaw);
          await startServer(port, (request) => {
            const url = new URL(request.url);
            if (url.pathname === "/healthcheck") {
              return new Response(JSON.stringify({ status: "ok", dispatcher: "running" }), {
                headers: { "content-type": "application/json" },
              });
            }
            return new Response("Not Found", { status: 404 });
          });
          process.stdout.write(
            `[xtandard/webhooks] dispatcher running; healthcheck on http://localhost:${port}/healthcheck\n`,
          );
        } else {
          // Dispatcher timers are unref()ed by design; hold the event loop open.
          setInterval(() => {}, 2 ** 30);
          process.stdout.write("[xtandard/webhooks] dispatcher running.\n");
        }
        // The worker owns the process now; never resolve so the bin doesn't exit.
        return await new Promise<number>(() => {});
      }
      case "serve": {
        const portalSecret = env("PORTAL_SECRET");
        const { createFetchHandler } = await import("./server/create-fetch-handler.ts");
        let dispatcherRunning = false;
        // `serve` reads PORT, BASE_PATH, TITLE, LOGO_URL and READONLY, warns on
        // AUTH_MODE=none, prints the banner and owns the process from then on.
        return await serve({
          name: "xtandard/webhooks",
          ...(typeof flags.port === "string" ? { port: Number(flags.port) } : {}),
          buildPanel: async ({ basePath, title, logoUrl, readonly }) => {
            const [storage, queueStorage, { auth, authorization }] = await Promise.all([
              buildStorage("STORAGE"),
              buildQueueStorage(),
              buildAuth(),
            ]);
            const retention = retentionFromEnv();
            const panel = createFetchHandler({
              storage,
              ...(queueStorage ? { queueStorage } : {}),
              basePath,
              ...(title ? { title } : {}),
              ...(logoUrl ? { logoUrl } : {}),
              readonly,
              auth,
              authorization,
              ...(portalSecret ? { portal: { secret: portalSecret } } : {}),
              ...(retention ? { retention } : {}),
              dispatcher: dispatcherEnabled() ? dispatcherOptionsFromEnv() : false,
            });
            dispatcherRunning = panel.dispatcher !== null;
            // The standalone healthcheck (Docker HEALTHCHECK): `{ status, title }`
            // at the root and under the base path, unauthenticated.
            const health = JSON.stringify({ status: "ok", title: title ?? "@xtandard/webhooks" });
            const fetch: FetchHandler = (request) => {
              const { pathname } = new URL(request.url);
              if (pathname === "/healthcheck" || pathname === `${basePath}/healthcheck`) {
                return new Response(health, { headers: { "content-type": "application/json" } });
              }
              return panel.fetch(request);
            };
            return { fetch, close: panel.close };
          },
          banner: async () => [
            `storage: ${await describeStorage("STORAGE")}`,
            `queue:   ${env("QUEUE_STORAGE_DRIVER") ? await describeStorage("QUEUE") : "(same store)"}`,
            `dispatcher: ${dispatcherRunning ? "running" : "disabled (DISPATCHER=0)"}`,
          ],
        });
      }
      default:
        process.stderr.write(`Unknown command: ${command}\n\n${helpText(await pkgVersion())}`);
        return 1;
    }
  } catch (err) {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

// Run only when executed directly (`bun src/cli.ts`), not when imported by the
// bin shim, the standalone app or a test.
if (isMainModule({ url: import.meta.url }))
  void run(process.argv.slice(2)).then((code) => process.exit(code));
