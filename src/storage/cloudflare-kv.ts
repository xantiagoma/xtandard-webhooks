/**
 * Cloudflare Workers KV storage adapter. It wraps a `KVNamespace` **binding** —
 * the object Workers exposes on `env.MY_KV` — so it works in production Workers,
 * in local dev via `wrangler dev` / [Miniflare](https://miniflare.dev), and in
 * tests against any object that satisfies the small {@link KVNamespaceLike}
 * surface. There is **no npm peer dependency**: the binding is provided by the
 * runtime, so this adapter only needs the structural type.
 *
 * KV is eventually consistent and has a ~25 MB per-value limit and list
 * pagination — acceptable for a webhooks control plane at library scale. An
 * optional `prefix` namespaces every key (joined with `:`) and is stripped from
 * {@link CloudflareKvWebhooksStorage.getKeys} results, so several deployments
 * can share one namespace. The driver is `@xtandard/kit/storage/cloudflare-kv`.
 *
 * **Dispatcher note:** Workers have no long-lived process, so the delivery
 * dispatcher cannot run its own interval loop. Configure a
 * [cron trigger](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
 * whose `scheduled` handler calls the dispatcher's `tick()` to drive due
 * deliveries.
 *
 * ```ts
 * import { createCloudflareKvStorage } from "@xtandard/webhooks/storage/cloudflare-kv";
 *
 * export default {
 *   async fetch(req: Request, env: { WEBHOOKS: KVNamespace }) {
 *     const storage = createCloudflareKvStorage({ namespace: env.WEBHOOKS, prefix: "prod" });
 *     // …build the webhooks core over `storage`…
 *   },
 * };
 * ```
 *
 * @module
 */

export {
  createCloudflareKvStorage,
  type CloudflareKvStorage as CloudflareKvWebhooksStorage,
  type CloudflareKvStorageOptions,
  type KVNamespaceLike,
} from "@xtandard/kit/storage/cloudflare-kv";
