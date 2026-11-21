/**
 * `@xtandard/webhooks/hooks/log` — a reference hook that logs mutation events.
 *
 * The simplest possible consumer of the hooks seam: useful as a starting point
 * for your own `after` side effects, and handy for local debugging or piping
 * admin activity to a log aggregator. Zero dependencies.
 *
 * @example
 * ```ts
 * import { createWebhooksCore } from "@xtandard/webhooks";
 * import { createLogHook } from "@xtandard/webhooks/hooks/log";
 *
 * createWebhooksCore({ storage, hooks: createLogHook() });
 * ```
 *
 * @module
 */

import * as kit from "@xtandard/kit/hooks/log";
import type { AfterEvent, BeforeEvent, WebhooksHooks } from "./contract.ts";

/**
 * Options for {@link createLogHook}: `log` (default `console.log`),
 * `includeBefore`, `json` (one JSON object per line), `describe` (an extra
 * text-format field) and `format` (replaces the whole line).
 */
export type LogHookOptions = kit.LogHookOptions<BeforeEvent, AfterEvent>;

/**
 * A hook that logs every `after` event (and, with `includeBefore`, every
 * `before` event) as `[@xtandard/webhooks] <phase> <type> <json>`. It never
 * throws from `before`, so it never denies a write.
 */
export function createLogHook(options: LogHookOptions = {}): WebhooksHooks {
  return kit.createLogHook<BeforeEvent, AfterEvent>({ source: "@xtandard/webhooks", ...options });
}
