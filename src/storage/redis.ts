/**
 * Redis storage adapters built on the [`redis`](https://github.com/redis/node-redis)
 * package (node-redis v4/v5), an optional peer dependency. You can either pass a
 * pre-connected `client` or a `url` to connect lazily on first use. An optional
 * `prefix` is prepended (with a `:` separator) to every key so multiple
 * deployments can share a Redis instance without collisions; the prefix is
 * stripped from keys returned by {@link RedisWebhooksStorage.getKeys}.
 *
 * Two variants over the same plumbing, differing only in the value encoding:
 *
 * - {@link createRedisStorage} — values are plain **strings** containing JSON
 *   (`SET`/`GET`). Works on any Redis; the default choice.
 * - {@link createRedisJSONStorage} — values are native **RedisJSON** documents
 *   (`JSON.SET`/`JSON.GET`), so the stored data is queryable with JSONPath and
 *   indexable with RediSearch. Requires the JSON module (Redis 8 / Redis Stack).
 *   Do NOT point both variants at the same keys — the types are incompatible
 *   (`WRONGTYPE`).
 *
 * `getKeys` uses a non-blocking `SCAN` cursor (never the blocking `KEYS`
 * command). `watch` is implemented with Redis keyspace notifications; it
 * requires the server to be configured with `notify-keyspace-events` covering
 * generic + string + expiry events (e.g. `KEA` — whose `A` class also covers the
 * module events that RedisJSON writes emit, e.g. `json.set`).
 *
 * ## Native delivery queue (`claimDue`)
 *
 * Both variants implement {@link DeliveryQueueStorage} natively: a sorted set at
 * `<prefix>whk:due` (score = due-time millis, member = the `whk/{app}/due/…`
 * key) is maintained alongside every `setItem`/`removeItem` that touches a
 * due-index key, keeping the zset and the plain keys consistent (so the generic
 * scan path still works). `claimDue` runs a small Lua script that atomically
 * pops due members up to `limit` by **repositioning** them at the lease expiry —
 * exclusivity between concurrent claimers is guaranteed by the script, and a
 * crashed claimer's members re-surface when the lease expires. The per-delivery
 * claim (verify claimable, write the lease, move the due key) then happens in
 * JS; under a race a claimer may return fewer than `limit`, never a duplicate.
 *
 * @module
 */

import type { RedisClientType } from "redis";
import { deliveryKey, dueKey, parseDueKey, ROOT, type DueEntry } from "../keys.ts";
import type { Delivery } from "../schema.ts";
import { requirePeer } from "./contract.ts";
import type {
  DeliveryQueueStorage,
  StorageChangeEvent,
  WatchableWebhooksStorage,
} from "./contract.ts";

/** Options for {@link createRedisStorage}. */
export interface RedisStorageOptions {
  /** Connection URL (e.g. `redis://localhost:6379`). Used when no `client` is given. */
  url?: string;
  /** A pre-constructed (optionally pre-connected) node-redis client. */
  client?: RedisClientType;
  /** Optional key namespace prepended to every key, joined with `:`. */
  prefix?: string;
  /**
   * Called on client `error` events (connection drops, reconnect failures).
   * A handler is always attached internally so a downed Redis never crashes the
   * process via an unhandled `error` event — this just lets you observe/log them.
   */
  onError?: (error: unknown) => void;
}

/**
 * A {@link WatchableWebhooksStorage} + {@link DeliveryQueueStorage} backed by
 * Redis, plus a `close()` method that disconnects the client — but only the one
 * this adapter created. A client you passed in is left for you to manage.
 */
export interface RedisWebhooksStorage extends WatchableWebhooksStorage, DeliveryQueueStorage {
  /** Disconnect the underlying client if this adapter created it. No-op otherwise. */
  close(): Promise<void>;
}

/** Minimal structural view of the node-redis client surface this adapter uses. */
interface RedisLike {
  isOpen?: boolean;
  on?(event: string, listener: (...args: unknown[]) => void): unknown;
  connect(): Promise<unknown>;
  quit(): Promise<unknown>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
  zAdd(key: string, members: { score: number; value: string }): Promise<unknown>;
  zRem(key: string, member: string): Promise<unknown>;
  eval(script: string, options?: { keys?: string[]; arguments?: string[] }): Promise<unknown>;
  /** RedisJSON module commands (bundled in node-redis; the SERVER needs the module). */
  json?: {
    get(key: string): Promise<unknown>;
    set(key: string, path: string, value: unknown): Promise<unknown>;
  };
  scanIterator(options?: { MATCH?: string; COUNT?: number }): AsyncIterable<string | string[]>;
  duplicate(): RedisLike;
  pSubscribe(
    pattern: string,
    listener: (message: string, channel: string) => void,
  ): Promise<unknown>;
  disconnect(): Promise<unknown>;
}

/** How a variant reads/writes values (the only place the two adapters differ). */
interface RedisValueCodec {
  get(c: RedisLike, key: string): Promise<unknown>;
  set(c: RedisLike, key: string, value: unknown): Promise<void>;
}

/** Plain strings containing JSON — works on any Redis. */
const stringCodec: RedisValueCodec = {
  async get(c, key) {
    const raw = await c.get(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  },
  async set(c, key, value) {
    await c.set(key, JSON.stringify(value));
  },
};

/** Native RedisJSON documents — requires the JSON module on the server. */
const jsonCodec: RedisValueCodec = {
  async get(c, key) {
    const value = await requireJson(c).get(key);
    return value ?? null;
  },
  async set(c, key, value) {
    await requireJson(c).set(key, "$", value);
  },
};

function requireJson(c: RedisLike): NonNullable<RedisLike["json"]> {
  if (!c.json) {
    throw new Error(
      "createRedisJSONStorage: the client exposes no `json` commands — use node-redis " +
        "(the `redis` package) v4+, and a server with the RedisJSON module (Redis 8 / Redis Stack).",
    );
  }
  return c.json;
}

/** Matches the due-index keys the adapter mirrors into the due sorted set. */
const DUE_KEY_RE = new RegExp(`^${ROOT}/[^/]+/due/`);

/**
 * Atomically pop up to `ARGV[2]` members due at or before `ARGV[1]` by
 * repositioning them at `ARGV[3]` (the lease expiry). Repositioning — instead of
 * removing — means a claimer that crashes right after this script re-surfaces
 * its members automatically when the lease expires.
 */
const CLAIM_SCRIPT = `
local members = redis.call('ZRANGEBYSCORE', KEYS[1], 0, ARGV[1], 'LIMIT', 0, tonumber(ARGV[2]))
for i = 1, #members do
  redis.call('ZADD', KEYS[1], ARGV[3], members[i])
end
return members`;

/**
 * Create a Redis-backed {@link RedisWebhooksStorage}. Connection is lazy: the
 * client is created/connected on the first storage operation and reused
 * thereafter, guarded by a single connection promise so concurrent calls connect
 * once.
 *
 * @example
 * ```ts
 * import { createRedisStorage } from "@xtandard/webhooks/storage/redis";
 *
 * const storage = createRedisStorage({
 *   url: process.env.REDIS_URL ?? "redis://localhost:6379",
 *   prefix: "myapp:webhooks",
 *   onError: (err) => console.error("[webhooks/redis]", err),
 * });
 *
 * // Disconnect when the process exits:
 * // process.on("SIGTERM", () => storage.close());
 * ```
 */
export function createRedisStorage(options: RedisStorageOptions): RedisWebhooksStorage {
  return buildRedisStorage(options, stringCodec);
}

/**
 * Create a Redis-backed {@link RedisWebhooksStorage} that stores values as native
 * **RedisJSON** documents (`JSON.SET`/`JSON.GET`) instead of strings — making
 * the stored records queryable with JSONPath (`JSON.GET key $.status`) and
 * indexable with RediSearch, while the webhooks system behaves identically.
 *
 * Requires the JSON module on the server (built into Redis 8; Redis Stack; or
 * `redisjson` loaded). Same options and semantics as {@link createRedisStorage},
 * including lazy connection, `SCAN`-based `getKeys`, keyspace-notification
 * `watch`, and the native due-queue `claimDue`. **Do not point it at keys
 * written by `createRedisStorage`** (or vice versa) — the underlying types
 * differ and Redis answers `WRONGTYPE`.
 *
 * @example
 * ```ts
 * import { createRedisJSONStorage } from "@xtandard/webhooks/storage/redis";
 *
 * const storage = createRedisJSONStorage({
 *   url: process.env.REDIS_URL ?? "redis://localhost:6379",
 *   prefix: "myapp:webhooks",
 * });
 * // Then, in redis-cli: JSON.GET myapp:webhooks:whk/acme/deliveries/dlv_1 $.status
 * ```
 */
export function createRedisJSONStorage(options: RedisStorageOptions): RedisWebhooksStorage {
  return buildRedisStorage(options, jsonCodec);
}

/** Shared implementation — connection, prefixing, SCAN, watch, due queue, close. */
function buildRedisStorage(
  options: RedisStorageOptions,
  codec: RedisValueCodec,
): RedisWebhooksStorage {
  const { url, prefix } = options;
  const fullPrefix = prefix ? `${prefix}:` : "";
  const ownsClient = !options.client;

  let client: RedisLike | undefined = options.client as RedisLike | undefined;
  let connecting: Promise<RedisLike> | undefined;

  // node-redis emits `error` on connection drops and reconnect attempts. Without a
  // listener Node treats it as an unhandled error and crashes the process — which
  // would defeat the whole "storage can be down" promise. Always attach one.
  const attachErrorHandler = (c: RedisLike): void => {
    c.on?.("error", (err: unknown) => options.onError?.(err));
  };
  if (client) attachErrorHandler(client);

  /** Resolve a connected client, creating/connecting on first use. */
  async function getClient(): Promise<RedisLike> {
    if (client?.isOpen) return client;
    connecting ??= (async () => {
      if (!client) {
        let createClient: (opts: Record<string, unknown>) => RedisLike;
        try {
          ({ createClient } = (await import("redis")) as unknown as {
            createClient: (opts: Record<string, unknown>) => RedisLike;
          });
        } catch {
          requirePeer("redis", "storage/redis");
        }
        // disableOfflineQueue: commands reject immediately when the socket is down
        // (instead of queueing forever) so a dispatcher tick fails fast and the
        // next tick retries. The reconnect strategy keeps trying with a capped
        // backoff so it recovers automatically.
        client = createClient({
          url,
          disableOfflineQueue: true,
          socket: { reconnectStrategy: (retries: number) => Math.min(retries * 100, 3000) },
        });
        attachErrorHandler(client);
      }
      if (!client.isOpen) await client.connect();
      return client;
    })();
    try {
      return await connecting;
    } finally {
      connecting = undefined;
    }
  }

  /** Prepend the namespace to a caller key. */
  const toRedisKey = (key: string): string => `${fullPrefix}${key}`;
  /** Strip the namespace off a Redis key, yielding the caller key. */
  const fromRedisKey = (key: string): string =>
    fullPrefix && key.startsWith(fullPrefix) ? key.slice(fullPrefix.length) : key;

  /**
   * The due-index sorted set (members are caller due keys; the zset key itself
   * carries the namespace). `:`-separated so it never collides with `whk/…`.
   */
  const dueZsetKey = toRedisKey(`${ROOT}:due`);

  return {
    async getItem<T>(key: string): Promise<T | null> {
      const c = await getClient();
      return ((await codec.get(c, toRedisKey(key))) as T | null) ?? null;
    },

    async setItem<T>(key: string, value: T): Promise<void> {
      const c = await getClient();
      await codec.set(c, toRedisKey(key), value);
      // Mirror due-index keys into the due zset so claimDue can pop by score.
      if (DUE_KEY_RE.test(key)) {
        const parsed = parseDueKey(key);
        if (parsed) await c.zAdd(dueZsetKey, { score: parsed.dueAtMillis, value: key });
      }
    },

    async removeItem(key: string): Promise<void> {
      const c = await getClient();
      await c.del(toRedisKey(key));
      if (DUE_KEY_RE.test(key)) await c.zRem(dueZsetKey, key);
    },

    async getKeys(prefix: string): Promise<string[]> {
      const c = await getClient();
      const match = `${toRedisKey(prefix)}*`;
      const out: string[] = [];
      for await (const entry of c.scanIterator({ MATCH: match, COUNT: 100 })) {
        // node-redis v4 yields one key per iteration; v5 may yield batches.
        if (Array.isArray(entry)) {
          for (const k of entry) out.push(fromRedisKey(k));
        } else {
          out.push(fromRedisKey(entry));
        }
      }
      return out;
    },

    async claimDue(input: { now: string; limit: number; leaseMs: number }): Promise<Delivery[]> {
      const c = await getClient();
      const nowMillis = Date.parse(input.now);
      const leaseExpiryMillis = nowMillis + input.leaseMs;
      // Atomic pop: reposition due members at the lease expiry so no concurrent
      // claimer can see them, while a crashed claimer's members re-surface.
      const members = (await c.eval(CLAIM_SCRIPT, {
        keys: [dueZsetKey],
        arguments: [String(nowMillis), String(input.limit), String(leaseExpiryMillis)],
      })) as string[] | null;

      const claimed: Delivery[] = [];
      for (const member of members ?? []) {
        const parsed = parseDueKey(member);
        if (!parsed) {
          await c.zRem(dueZsetKey, member); // unparseable member — sweep from the zset
          continue;
        }
        const entry = (await codec.get(c, toRedisKey(member))) as DueEntry | null;
        if (!entry) {
          await c.zRem(dueZsetKey, member); // stale zset member with no backing key
          continue;
        }
        const dKey = deliveryKey(entry.app, entry.deliveryId);
        const delivery = (await codec.get(c, toRedisKey(dKey))) as Delivery | null;
        // Orphaned or already-terminal entries are garbage — sweep them.
        if (!delivery || delivery.status === "succeeded" || delivery.status === "failed") {
          await c.del(toRedisKey(member));
          await c.zRem(dueZsetKey, member);
          continue;
        }
        // Claimable = pending, or delivering with an expired lease. A delivery
        // with an active lease was claimed elsewhere; its member is already
        // repositioned near the lease expiry, so just skip it.
        const leaseExpired =
          delivery.status === "delivering" &&
          (!delivery.leaseUntil || Date.parse(delivery.leaseUntil) <= nowMillis);
        if (delivery.status !== "pending" && !leaseExpired) continue;

        const leaseUntil = new Date(leaseExpiryMillis).toISOString();
        const next: Delivery = {
          ...delivery,
          status: "delivering",
          leaseUntil,
          updatedAt: input.now,
        };
        await codec.set(c, toRedisKey(dKey), next);
        // Move the due entry (plain key + zset member) to the lease-expiry
        // position so a crashed claimer's work re-surfaces automatically.
        const nextDueKey = dueKey(entry.app, leaseExpiryMillis, entry.deliveryId);
        await c.del(toRedisKey(member));
        await c.zRem(dueZsetKey, member);
        await codec.set(c, toRedisKey(nextDueKey), entry);
        await c.zAdd(dueZsetKey, { score: leaseExpiryMillis, value: nextDueKey });
        claimed.push(next);
      }
      return claimed;
    },

    async watch(
      prefix: string,
      callback: (event: StorageChangeEvent) => void,
    ): Promise<() => void> {
      // Keyspace notifications publish to `__keyspace@<db>__:<key>`; subscribe to
      // all key events under our namespaced prefix and translate them.
      const c = await getClient();
      const subscriber = c.duplicate();
      attachErrorHandler(subscriber);
      await subscriber.connect();
      const pattern = `__keyspace@*__:${toRedisKey(prefix)}*`;
      await subscriber.pSubscribe(pattern, (event: string, channel: string) => {
        const idx = channel.indexOf("__:");
        if (idx === -1) return;
        const redisKey = channel.slice(idx + 3);
        const key = fromRedisKey(redisKey);
        if (!key.startsWith(prefix)) return;
        const type: StorageChangeEvent["type"] =
          event === "del" || event === "expired" ? "remove" : "update";
        callback({ type, key });
      });
      return () => {
        void subscriber.disconnect();
      };
    },

    async close(): Promise<void> {
      if (ownsClient && client?.isOpen) await client.quit();
    },
  } satisfies RedisWebhooksStorage;
}
