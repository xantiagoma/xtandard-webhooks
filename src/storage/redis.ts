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
 * The driver is `@xtandard/kit/storage/redis`: `getKeys` uses a de-duplicated,
 * glob-escaped `SCAN`; `watch` uses keyspace notifications and needs
 * `notify-keyspace-events` covering generic + string + expiry events (e.g.
 * `KEA`, whose `A` class also covers RedisJSON's module events);
 * `compareAndSwap` is a Lua script.
 *
 * ## Native delivery queue (`claimDue`)
 *
 * Both variants implement {@link DeliveryQueueStorage} natively: a sorted set at
 * `<prefix>:whk:due` (score = due-time millis, member = the `whk/{app}/due/…`
 * key) is kept in step with every write and remove of a due-index key through
 * the driver's `onWrite` hook (so the generic scan path still works).
 * `claimDue` runs a small Lua script that atomically pops due members up to
 * `limit` by **repositioning** them at the lease expiry — exclusivity between
 * concurrent claimers is guaranteed by the script, and a crashed claimer's
 * members re-surface when the lease expires. The per-delivery claim is then a
 * compare-and-swap; under a race a claimer may return fewer than `limit`, never
 * a duplicate.
 *
 * @module
 */

import type { RedisClientType } from "redis";
import type {
  RedisKvStorage,
  RedisStorageOptions as KitRedisStorageOptions,
} from "@xtandard/kit/storage/redis";
import {
  createRedisKvStorage,
  jsonCodec,
  redisConnection,
  stringCodec,
  type RedisValueCodec,
} from "@xtandard/kit/storage/redis/internals";
import { parseDueKey, ROOT } from "../keys.ts";
import type { DeliveryQueueStorage } from "./contract.ts";
import { claimDueEntries, DUE_KEY_RE } from "./due-queue.ts";

/** Options for {@link createRedisStorage}. */
export interface RedisStorageOptions extends Omit<KitRedisStorageOptions, "onWrite"> {
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
 * A watchable, compare-and-swap {@link DeliveryQueueStorage} backed by Redis,
 * plus a `close()` method that disconnects the client — but only the one this
 * adapter created. A client you passed in is left for you to manage.
 */
export interface RedisWebhooksStorage extends RedisKvStorage, DeliveryQueueStorage {}

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

/** The kit driver plus the due sorted set and `claimDue`. */
function buildRedisStorage(
  options: RedisStorageOptions,
  codec: RedisValueCodec,
): RedisWebhooksStorage {
  const connection = redisConnection(options, "@xtandard/webhooks/storage/redis");
  // The zset key carries the namespace; `:`-separated so it never collides with `whk/…`.
  const dueZsetKey = `${options.prefix ? `${options.prefix}:` : ""}${ROOT}:due`;

  const base = createRedisKvStorage({
    ...options,
    codec,
    connection,
    // Mirror due-index keys into the due zset so claimDue can pop by score.
    onWrite: async (key, value, { client }) => {
      if (!DUE_KEY_RE.test(key)) return;
      if (value === null) {
        await client.zRem(dueZsetKey, key);
        return;
      }
      const parsed = parseDueKey(key);
      if (parsed) await client.zAdd(dueZsetKey, { score: parsed.dueAtMillis, value: key });
    },
  });

  return {
    ...base,
    async claimDue(input) {
      const c = await connection.get();
      const nowMillis = Date.parse(input.now);
      // Atomic pop: reposition due members at the lease expiry so no concurrent
      // claimer can see them, while a crashed claimer's members re-surface.
      const members = (await c.eval(CLAIM_SCRIPT, {
        keys: [dueZsetKey],
        arguments: [String(nowMillis), String(input.limit), String(nowMillis + input.leaseMs)],
      })) as string[] | null;
      const valid: string[] = [];
      for (const member of members ?? []) {
        if (parseDueKey(member)) valid.push(member);
        else await c.zRem(dueZsetKey, member); // unparseable member — sweep from the zset
      }
      return claimDueEntries(base, valid, input);
    },
  };
}
