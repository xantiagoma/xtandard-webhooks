/**
 * Duration parsing for {@link ./schema.WebhookDuration} config values. Zero
 * dependencies; shared by the core (rotation grace, retention) and the
 * dispatcher (retry schedule).
 *
 * @module
 */

import type { WebhookDuration } from "./schema.ts";

const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

const DURATION_RE = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/;

/**
 * Convert a {@link WebhookDuration} (`5000`, `"5s"`, `"30m"`, `"2h"`, `"5d"`)
 * to milliseconds. Throws on malformed strings or negative numbers.
 *
 * @example
 * ```ts
 * import { durationToMs } from "@xtandard/webhooks";
 *
 * durationToMs("5m"); // 300000
 * durationToMs(250); // 250
 * ```
 */
export function durationToMs(duration: WebhookDuration): number {
  if (typeof duration === "number") {
    if (!Number.isFinite(duration) || duration < 0) {
      throw new Error(`Invalid duration: ${duration}`);
    }
    return duration;
  }
  const match = DURATION_RE.exec(duration.trim());
  if (!match) throw new Error(`Invalid duration: "${duration}" (expected e.g. "5s", "30m", "2h")`);
  const value = Number(match[1]);
  const unit = UNIT_MS[match[2] as keyof typeof UNIT_MS];
  return value * (unit as number);
}

/**
 * Parse a comma-separated duration list (the `RETRY_SCHEDULE` env var format,
 * e.g. `"0s,5s,5m,30m,2h,5h,10h"`) into a {@link WebhookDuration} array.
 */
export function parseDurationList(input: string): WebhookDuration[] {
  return input
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const asNumber = Number(part);
      const duration = (Number.isFinite(asNumber) ? asNumber : part) as WebhookDuration;
      durationToMs(duration); // validate eagerly so a bad list fails at parse time
      return duration;
    });
}
