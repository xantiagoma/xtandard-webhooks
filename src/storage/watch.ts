/**
 * Composable change-notifications. `watch` is **orthogonal** to which storage
 * you use, so rather than bake it into each adapter, {@link withWatch} wraps
 * *any* {@link WebhooksStorage} with a {@link WatchSubscribe} source you provide
 * — Postgres `LISTEN`/`NOTIFY`, Redis pub/sub, an ORM after-write hook, a
 * websocket, an `EventEmitter`, etc.
 *
 * This gives `watch` to adapters that don't implement it themselves (postgres,
 * drizzle, mongodb, unstorage, cloudflare-kv, …), driven by whatever change
 * signal your infrastructure already has.
 *
 * @example
 * ```ts
 * import { withWatch } from "@xtandard/webhooks";
 * import { createDrizzleStorage } from "@xtandard/webhooks/storage/drizzle";
 *
 * const storage = withWatch(createDrizzleStorage({ db, table }), (notify) => {
 *   const sub = redis.subscribe("webhook-changes", (m) => notify(m.key));
 *   return () => sub.unsubscribe();
 * });
 * ```
 *
 * @module
 */

import type { StorageChangeEvent, WatchableWebhooksStorage, WebhooksStorage } from "./contract.ts";

/**
 * A change source. Called with a `notify` callback — wire your source to invoke
 * it (optionally with the changed key) on every change — and return an
 * unsubscribe function (sync or async).
 */
export type WatchSubscribe = (
  notify: (key?: string) => void,
) => (() => void | Promise<void>) | Promise<() => void | Promise<void>>;

/**
 * Wrap a storage so it implements {@link WatchableWebhooksStorage} using
 * `subscribe` as the change source. The wrapper delegates all reads/writes to
 * `storage` and only adds `watch`; keys not under the watched `prefix` are
 * filtered out. A notification without a key is delivered as a change to the
 * prefix itself (enough to trigger a refresh).
 */
export function withWatch<S extends WebhooksStorage>(
  storage: S,
  subscribe: WatchSubscribe,
): S & WatchableWebhooksStorage {
  const watchable = Object.create(storage) as S & WatchableWebhooksStorage;
  watchable.watch = (prefix, callback) => {
    const notify = (key?: string): void => {
      if (key !== undefined && key !== "" && !key.startsWith(prefix)) return;
      callback({
        type: "update",
        key: key && key !== "" ? key : prefix,
      } satisfies StorageChangeEvent);
    };
    return Promise.resolve(subscribe(notify));
  };
  return watchable;
}

/**
 * A dedicated notification client for {@link pgListenNotify} — satisfied by a
 * `pg` `Client`. `Pool` won't do (it rotates connections); use a `Client` you
 * `connect()`.
 */
export interface PgNotificationClient {
  query(sql: string): Promise<unknown>;
  on(event: "notification", listener: (msg: { channel: string; payload?: string }) => void): void;
  removeListener(
    event: "notification",
    listener: (msg: { channel: string; payload?: string }) => void,
  ): void;
}

/**
 * A {@link WatchSubscribe} backed by Postgres `LISTEN`/`NOTIFY`. Pair with
 * {@link withWatch} for the postgres or drizzle-over-pg adapters. Your migration
 * owns the trigger that `pg_notify`s `channel` with the changed key as payload;
 * this only `LISTEN`s.
 *
 * @example
 * ```ts
 * import { Client } from "pg";
 * const listener = new Client({ connectionString: process.env.DATABASE_URL });
 * await listener.connect();
 * const storage = withWatch(base, pgListenNotify(listener, "xtandard_webhooks"));
 * ```
 */
export function pgListenNotify(
  client: PgNotificationClient,
  channel = "xtandard_webhooks",
): WatchSubscribe {
  return async (notify) => {
    const listener = (msg: { channel: string; payload?: string }): void => {
      if (msg.channel === channel) notify(msg.payload);
    };
    client.on("notification", listener);
    await client.query(`LISTEN "${channel.replace(/"/g, '""')}"`);
    return async () => {
      client.removeListener("notification", listener);
      await client.query(`UNLISTEN "${channel.replace(/"/g, '""')}"`);
    };
  };
}
