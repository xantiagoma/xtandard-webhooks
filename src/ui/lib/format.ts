/**
 * Pure UI helpers — no React, no DOM. Unit-tested in `test/ui-lib.test.ts`
 * (visual behavior is covered by the Playwright e2e suite instead).
 *
 * @module
 */

import type { DeliveryStatus, EventType } from "../types.ts";

/** Absolute date-time, locale-aware. Returns `"—"` for missing/invalid input. */
export function formatDateTime(iso: string | undefined | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

/**
 * Compact relative time: `"just now"`, `"5m ago"`, `"in 2h"`, `"3d ago"`.
 * `now` is injectable for tests; defaults to the current time.
 */
export function relativeTime(iso: string | undefined | null, now: number = Date.now()): string {
  if (!iso) return "—";
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "—";
  const diff = now - at;
  const abs = Math.abs(diff);
  if (abs < 10_000) return "just now";
  const units: [number, string][] = [
    [1000, "s"],
    [60_000, "m"],
    [3_600_000, "h"],
    [86_400_000, "d"],
  ];
  let value = Math.round(abs / 1000);
  let unit = "s";
  for (const [ms, label] of units) {
    if (abs >= ms) {
      value = Math.round(abs / ms);
      unit = label;
    }
  }
  return diff >= 0 ? `${value}${unit} ago` : `in ${value}${unit}`;
}

/** Attempt duration: `"87 ms"` below a second, `"1.25 s"` above. */
export function formatDurationMs(ms: number | undefined | null): string {
  if (ms === undefined || ms === null || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2).replace(/\.?0+$/, "")} s`;
}

/** Human label for a delivery status (`failed` reads as the dead-letter state). */
export function deliveryStatusLabel(status: DeliveryStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "delivering":
      return "Delivering";
    case "succeeded":
      return "Succeeded";
    case "failed":
      return "Dead-letter";
  }
}

/** Tailwind classes for a delivery-status badge (flags badge tone conventions). */
export function deliveryStatusTone(status: DeliveryStatus): string {
  switch (status) {
    case "succeeded":
      return "border-success/30 bg-success/10 text-success";
    case "failed":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    case "delivering":
      return "border-chart-2/30 bg-chart-2/10 text-chart-2";
    case "pending":
      return "border-warning/30 bg-warning/10 text-warning";
  }
}

/** Truncate with an ellipsis; never longer than `max` (including the ellipsis). */
export function truncate(text: string, max: number): string {
  if (max <= 1) return text.length > max ? "…" : text;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Append the app-scoped query string to an in-app path, preserving existing
 * params on the path. `""` app (portal mode) leaves the path untouched.
 */
export function withAppQuery(path: string, app: string): string {
  if (!app) return path;
  const [pathname = "", existing] = path.split("?");
  const params = new URLSearchParams(existing ?? "");
  params.set("app", app);
  return `${pathname}?${params.toString()}`;
}

/**
 * Group an event-type catalog by `groupName`, ungrouped last. Groups sorted by
 * name; entries keep catalog (name) order within a group.
 */
export function groupEventTypes(catalog: EventType[]): { group: string; types: EventType[] }[] {
  const grouped = new Map<string, EventType[]>();
  for (const type of [...catalog].sort((a, b) => a.name.localeCompare(b.name))) {
    const group = type.groupName ?? "";
    const list = grouped.get(group) ?? [];
    list.push(type);
    grouped.set(group, list);
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)))
    .map(([group, types]) => ({ group: group || "Ungrouped", types }));
}

/** Success rate in percent over terminal deliveries; `null` when there are none. */
export function successRate(succeeded: number, failed: number): number | null {
  const total = succeeded + failed;
  if (total === 0) return null;
  return Math.round((succeeded / total) * 100);
}

/** True when `iso` falls within the last `windowMs` before `now`. */
export function withinWindow(
  iso: string | undefined | null,
  windowMs: number,
  now: number = Date.now(),
): boolean {
  if (!iso) return false;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return false;
  return at <= now && now - at <= windowMs;
}
