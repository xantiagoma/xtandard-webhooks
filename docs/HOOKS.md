# Hooks

Control-plane extensibility around admin mutations, plus the delivery-plane observation sink. Hooks are plain JavaScript wired in at construction time — never authored through the UI (that would be remote code execution).

## The two phases

|         | `before`                          | `after`                                                 |
| ------- | --------------------------------- | ------------------------------------------------------- |
| Runs    | before a mutation commits         | after it commits                                        |
| Order   | sequentially, declared order      | concurrently                                            |
| Failure | **throw = deny**; nothing commits | isolated; reported to `onHookError`, never fails the op |
| Use for | governance, quotas, publish gates | notifications, cache purges, offloading pruned payloads |

```ts
import { createWebhooksCore, HookDeniedError } from "@xtandard/webhooks";

const core = createWebhooksCore({
  storage,
  hooks: {
    before(event) {
      if (event.type === "message.publish" && overQuota(event.applicationKey)) {
        throw new HookDeniedError("Monthly webhook quota exceeded.", { status: 429 });
      }
    },
    async after(event) {
      if (event.type === "delivery.exhausted") {
        await pager.notify(`dead-letter for ${event.applicationKey}: ${event.delivery.id}`);
      }
    },
  },
});
```

`HookDeniedError` maps to its `status` (default 403) at the API layer; any other thrown error maps to 500 (treated as a bug, not a policy).

## Event catalog

`before` (veto points): `application.create|update|delete`, `event-type.upsert|delete`, `endpoint.create|update|delete|rotate-secret|disable|enable`, `message.publish` (the host's approval/quota gate), `delivery.retry`, `endpoint.recover`. All carry `actor`.

`after` (committed state, full payloads): `application.created|updated|deleted`, `event-type.upserted|deleted`, `endpoint.created|updated|deleted|secret-rotated|disabled|enabled|auto-disabled`, `message.published` (message + delivery ids), `delivery.succeeded` (delivery + final attempt), `delivery.exhausted` (delivery + all attempts — **the dead-letter offload point**), `message.pruned` (full removed messages), `audit.pruned` (removed entries).

The offload contract: every destructive/pruning action emits its `after` event carrying the full payload _first_ — your last chance to ship it to S3/warehouse/SIEM before it is gone from storage.

## The delivery sink (`onDelivery`)

Attempts are data-plane traffic and deliberately **not** hook events — `after` only sees terminal transitions. The per-attempt tap is the fire-and-forget sink:

```ts
createWebhooksCore({
  storage,
  onDelivery(event) {
    metrics.increment("webhook_attempts", {
      app: event.applicationKey,
      ok: String(event.ok),
      status: String(event.httpStatus ?? "network-error"),
      trigger: event.trigger,
    });
  },
  onDeliveryError(error) {
    log.warn("delivery sink failed", error);
  },
});
```

Never awaited, errors never propagate — a broken sink cannot slow or fail a delivery.

## Bundled hooks

- `@xtandard/webhooks/hooks/log` — `createLogHook()`: logs each event, the reference implementation to copy.

That's the whole catalog on purpose (anti-bloat): a webhook-emitting hook inside a webhooks package would be recursion comedy, and anything else is ten lines against the seam above.
