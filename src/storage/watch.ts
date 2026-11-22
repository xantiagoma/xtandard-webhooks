/**
 * Composable change-notifications. `watch` is **orthogonal** to which storage
 * you use, so rather than bake it into each adapter, {@link withWatch} wraps
 * *any* {@link WebhooksStorage} with a {@link WatchSubscribe} source you provide
 * — Postgres `LISTEN`/`NOTIFY`, Redis pub/sub, an ORM after-write hook, a
 * websocket, an `EventEmitter`, etc. Both helpers come from
 * `@xtandard/kit/storage`; {@link pgListenNotify} keeps the webhooks default
 * channel `"xtandard_webhooks"`.
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

import {
  pgListenNotify as kitPgListenNotify,
  type PgNotificationClient,
  type WatchSubscribe,
} from "@xtandard/kit/storage";

export { withWatch, type PgNotificationClient, type WatchSubscribe } from "@xtandard/kit/storage";

/**
 * A {@link WatchSubscribe} source for Postgres `LISTEN`/`NOTIFY`: the database
 * owns the trigger that `pg_notify`s `channel` with the changed key as payload;
 * `client` is a dedicated listening connection.
 *
 * @example
 * ```ts
 * const storage = withWatch(base, pgListenNotify(listener, "xtandard_webhooks"));
 * ```
 */
export function pgListenNotify(
  client: PgNotificationClient,
  channel = "xtandard_webhooks",
): WatchSubscribe {
  return kitPgListenNotify(client, channel);
}
