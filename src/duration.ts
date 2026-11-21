/**
 * Duration parsing for {@link ./schema.WebhookDuration} config values. Zero
 * dependencies; shared by the core (rotation grace, retention) and the
 * dispatcher (retry schedule).
 *
 * @module
 */

import {
  durationToMs as kitDurationToMs,
  parseDurationList as kitParseDurationList,
} from "@xtandard/kit/util";
import type { WebhookDuration } from "./schema.ts";

/**
 * Convert a {@link WebhookDuration} to milliseconds: a non-negative number of
 * ms, or `"<n><unit>"` with unit `ms`, `s`, `m`, `h`, `d` (or `w`). Throws on
 * negative, non-finite or malformed values.
 */
export function durationToMs(duration: WebhookDuration): number {
  return kitDurationToMs(duration);
}

/**
 * Parse a comma-separated duration list (e.g. the `RETRY_SCHEDULE` env var,
 * `"0,30s,5m,1h"`), validating each entry eagerly.
 */
export function parseDurationList(input: string): WebhookDuration[] {
  return kitParseDurationList(input) as WebhookDuration[];
}
