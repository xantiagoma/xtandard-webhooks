/**
 * `xtandard-webhooks` CLI. Operates on the same storage your app/panel uses
 * (configured via the `STORAGE_DRIVER` / `QUEUE_STORAGE_DRIVER` env vars,
 * mirroring the standalone app), so it slots into shell, CI, and split-worker
 * workflows.
 *
 * Commands: `serve` (panel + dispatcher, no Docker), `dispatch` (dispatcher
 * ONLY — the split-worker mode), `init`, `list-apps`, `list-endpoints`,
 * `publish`, `retry`, `verify`.
 *
 * @module
 */

import type { AuthProvider } from "./auth/contract.ts";
import type { AuthorizationProvider } from "./authorization/contract.ts";
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

type Driver = "memory" | "file" | "redis" | "postgres" | "mongodb" | "sqlite" | "libsql";

/** The two storage roles: control plane (`STORAGE`) and delivery queue (`QUEUE`). */
type Role = "STORAGE" | "QUEUE";

const env = (key: string, fallback = ""): string => process.env[key] ?? fallback;

const isTruthy = (value: string): boolean => value === "1" || value.toLowerCase() === "true";

/**
 * The driver env var for a role: `STORAGE_DRIVER` for the control plane,
 * `QUEUE_STORAGE_DRIVER` for the delivery queue.
 */
const driverEnv = (role: Role): string =>
  role === "STORAGE" ? "STORAGE_DRIVER" : "QUEUE_STORAGE_DRIVER";

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
  const driver = (env(driverEnv(role), "file") as Driver) || "file";
  const r = role.toLowerCase();
  switch (driver) {
    case "redis": {
      const { createRedisStorage } = await import("./storage/redis.ts");
      return createRedisStorage({
        url: env("REDIS_URL", "redis://localhost:6379"),
        prefix: env(`${role}_PREFIX`, `xtandard:webhooks:${r}`),
      });
    }
    case "postgres": {
      const { createPostgresStorage } = await import("./storage/postgres.ts");
      return createPostgresStorage({
        connectionString:
          env("DATABASE_URL") || env("POSTGRES_URL", "postgres://localhost:5432/postgres"),
        table: env(`${role}_PG_TABLE`, `xtandard_webhooks_${r}`),
      });
    }
    case "mongodb": {
      const { createMongoStorage } = await import("./storage/mongodb.ts");
      return createMongoStorage({
        url: env("MONGO_URL", "mongodb://localhost:27017"),
        dbName: env("MONGO_DB", "xtandard_webhooks"),
        collectionName: env(`${role}_MONGO_COLLECTION`, `webhooks_${r}`),
      });
    }
    case "sqlite": {
      // Requires running the CLI under Bun (`bunx xtandard-webhooks …`).
      const { createSqliteStorage } = await import("./storage/sqlite.ts");
      return createSqliteStorage({
        path: env(`${role}_SQLITE_PATH`, `./.webhooks/${r}.sqlite`),
      });
    }
    case "libsql": {
      const { createLibsqlStorage } = await import("./storage/libsql.ts");
      const authToken = env("LIBSQL_AUTH_TOKEN");
      return createLibsqlStorage({
        url: env(`${role}_LIBSQL_URL`) || env("LIBSQL_URL", `file:./.webhooks/${r}.db`),
        ...(authToken ? { authToken } : {}),
      });
    }
    case "memory": {
      const { createMemoryStorage } = await import("./storage/memory.ts");
      return createMemoryStorage();
    }
    case "file":
    default: {
      const { createFileStorage } = await import("./storage/file.ts");
      return createFileStorage({ dir: env(`${role}_FILE_DIR`, `./.webhooks/${r}`) });
    }
  }
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
  const { resolve } = await import("node:path");
  const driver = (env(driverEnv(role), "file") as Driver) || "file";
  const r = role.toLowerCase();
  switch (driver) {
    case "file":
      return `file → ${resolve(env(`${role}_FILE_DIR`, `./.webhooks/${r}`))}`;
    case "sqlite":
      return `sqlite → ${resolve(env(`${role}_SQLITE_PATH`, `./.webhooks/${r}.sqlite`))}`;
    case "memory":
      return "memory (ephemeral — not persisted)";
    default:
      return driver;
  }
}

/** Build the auth + authorization providers from env (mirrors the standalone app). */
async function buildAuth(): Promise<{ auth: AuthProvider; authorization: AuthorizationProvider }> {
  const mode = env("AUTH_MODE", "none");
  if (mode === "basic") {
    const [{ basicAuth }, { rolesAuthorization }] = await Promise.all([
      import("./auth/basic.ts"),
      import("./authorization/roles.ts"),
    ]);
    const passwordHash = env("AUTH_PASSWORD_HASH");
    const password = env("AUTH_PASSWORD");
    if (!passwordHash && !password) {
      process.stderr.write(
        "[xtandard/webhooks] AUTH_MODE=basic but neither AUTH_PASSWORD_HASH nor AUTH_PASSWORD is set.\n",
      );
    }
    return {
      auth: basicAuth({
        users: [
          {
            username: env("AUTH_USERNAME", "admin"),
            ...(passwordHash ? { passwordHash } : {}),
            ...(password ? { password } : {}),
            roles: ["admin"],
          },
        ],
      }),
      authorization: rolesAuthorization({}),
    };
  }
  const [{ noAuth }, { noAuthorization }] = await Promise.all([
    import("./auth/none.ts"),
    import("./authorization/none.ts"),
  ]);
  return { auth: noAuth(), authorization: noAuthorization() };
}

type FetchHandler = (request: Request) => Response | Promise<Response>;

/**
 * Serve a web-standard fetch handler under whatever runtime the CLI runs on:
 * `Bun.serve` under `bunx`, a `node:http` bridge under `npx`/Node. Resolves only
 * once the server is listening; the process then stays alive on the open socket.
 */
async function startServer(port: number, fetch: FetchHandler): Promise<void> {
  const bun = (globalThis as { Bun?: { serve: (options: unknown) => unknown } }).Bun;
  if (bun) {
    bun.serve({ port, fetch });
    return;
  }
  const { createServer } = await import("node:http");
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const method = req.method ?? "GET";
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) {
          if (v === undefined) continue;
          headers.set(k, Array.isArray(v) ? v.join(", ") : v);
        }
        const host = req.headers.host ?? `localhost:${port}`;
        const url = `http://${host}${req.url ?? "/"}`;
        const hasBody = method !== "GET" && method !== "HEAD" && chunks.length > 0;
        const request = new Request(url, {
          method,
          headers,
          body: hasBody ? Buffer.concat(chunks) : undefined,
        });
        const response = await fetch(request);
        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch (err) {
        res.statusCode = 500;
        res.end(`Internal error: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(port, resolve));
}

/** Minimal flag/value argv parser: `--key value` and `--flag`. */
function parseArgs(argv: string[]): { _: string[]; flags: Record<string, string | boolean> } {
  const _: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) flags[key] = true;
      else {
        flags[key] = next;
        i++;
      }
    } else _.push(a);
  }
  return { _, flags };
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

/** Read this package's version from the nearest package.json (dist or src). */
async function pkgVersion(): Promise<string> {
  try {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const pkg = JSON.parse(
      await readFile(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
    ) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

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
    AUTH_MODE       none|basic  Authentication mode (default none).
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
        const port = Number((flags.port as string) || env("PORT", "3000"));
        const basePath = env("BASE_PATH", "");
        const title = env("TITLE", "@xtandard/webhooks");
        const logoUrl = env("LOGO_URL");
        const readonly = isTruthy(env("READONLY"));
        const authMode = env("AUTH_MODE", "none");
        const portalSecret = env("PORTAL_SECRET");

        const { createFetchHandler } = await import("./server/create-fetch-handler.ts");
        const [storage, queueStorage] = await Promise.all([
          buildStorage("STORAGE"),
          buildQueueStorage(),
        ]);
        const { auth, authorization } = await buildAuth();

        if (authMode === "none") {
          process.stderr.write(
            "[xtandard/webhooks] AUTH_MODE=none — do NOT expose this publicly without authentication.\n",
          );
        }

        const retention = retentionFromEnv();
        const panel = createFetchHandler({
          storage,
          ...(queueStorage ? { queueStorage } : {}),
          basePath,
          title,
          ...(logoUrl ? { logoUrl } : {}),
          readonly,
          auth,
          authorization,
          ...(portalSecret ? { portal: { secret: portalSecret } } : {}),
          ...(retention ? { retention } : {}),
          dispatcher: dispatcherEnabled() ? dispatcherOptionsFromEnv() : false,
        });

        const normalizedBase =
          basePath && basePath !== "/"
            ? basePath.startsWith("/")
              ? basePath
              : `/${basePath}`
            : "";

        const handler: FetchHandler = (request) => {
          const url = new URL(request.url);
          if (url.pathname === "/healthcheck" || url.pathname === `${normalizedBase}/healthcheck`) {
            return new Response(JSON.stringify({ status: "ok", title }), {
              headers: { "content-type": "application/json" },
            });
          }
          return panel.fetch(request);
        };

        const [storageDesc, queueDesc] = await Promise.all([
          describeStorage("STORAGE"),
          env("QUEUE_STORAGE_DRIVER") ? describeStorage("QUEUE") : Promise.resolve("(same store)"),
        ]);
        process.stdout.write(`[xtandard/webhooks] storage: ${storageDesc}\n`);
        process.stdout.write(`[xtandard/webhooks] queue:   ${queueDesc}\n`);
        process.stdout.write(
          `[xtandard/webhooks] dispatcher: ${panel.dispatcher ? "running" : "disabled (DISPATCHER=0)"}\n`,
        );

        await startServer(port, handler);
        process.stdout.write(
          `[xtandard/webhooks] listening on http://localhost:${port}${normalizedBase || "/"}\n`,
        );
        // The server owns the process now; never resolve so the bin doesn't exit.
        return await new Promise<number>(() => {});
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
