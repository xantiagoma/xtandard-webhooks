import { describe, expect, it } from "vitest";
import {
  deliveryStatusLabel,
  deliveryStatusTone,
  formatDateTime,
  formatDurationMs,
  groupEventTypes,
  relativeTime,
  successRate,
  truncate,
  withAppQuery,
  withinWindow,
} from "../src/ui/lib/format.ts";

describe("formatDateTime", () => {
  it("formats an ISO timestamp", () => {
    const out = formatDateTime("2026-01-02T03:04:05.000Z");
    expect(out).toContain("2026");
    expect(out).not.toBe("—");
  });

  it("returns a dash for missing or invalid input", () => {
    expect(formatDateTime(undefined)).toBe("—");
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime("not-a-date")).toBe("—");
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-07-04T12:00:00.000Z");

  it("says just now within ten seconds", () => {
    expect(relativeTime("2026-07-04T11:59:55.000Z", now)).toBe("just now");
  });

  it("formats past times per unit", () => {
    expect(relativeTime("2026-07-04T11:59:30.000Z", now)).toBe("30s ago");
    expect(relativeTime("2026-07-04T11:55:00.000Z", now)).toBe("5m ago");
    expect(relativeTime("2026-07-04T09:00:00.000Z", now)).toBe("3h ago");
    expect(relativeTime("2026-07-01T12:00:00.000Z", now)).toBe("3d ago");
  });

  it("formats future times with an in prefix", () => {
    expect(relativeTime("2026-07-04T12:05:00.000Z", now)).toBe("in 5m");
  });

  it("returns a dash for missing or invalid input", () => {
    expect(relativeTime(undefined, now)).toBe("—");
    expect(relativeTime("garbage", now)).toBe("—");
  });
});

describe("formatDurationMs", () => {
  it("uses milliseconds below a second", () => {
    expect(formatDurationMs(87)).toBe("87 ms");
    expect(formatDurationMs(0)).toBe("0 ms");
    expect(formatDurationMs(999.4)).toBe("999 ms");
  });

  it("uses seconds at or above a second, trimming zeros", () => {
    expect(formatDurationMs(1000)).toBe("1 s");
    expect(formatDurationMs(1250)).toBe("1.25 s");
    expect(formatDurationMs(2500)).toBe("2.5 s");
  });

  it("returns a dash for invalid input", () => {
    expect(formatDurationMs(undefined)).toBe("—");
    expect(formatDurationMs(-5)).toBe("—");
    expect(formatDurationMs(Number.NaN)).toBe("—");
  });
});

describe("deliveryStatusLabel", () => {
  it("labels failed as the dead-letter state", () => {
    expect(deliveryStatusLabel("failed")).toBe("Dead-letter");
    expect(deliveryStatusLabel("pending")).toBe("Pending");
    expect(deliveryStatusLabel("delivering")).toBe("Delivering");
    expect(deliveryStatusLabel("succeeded")).toBe("Succeeded");
  });
});

describe("deliveryStatusTone", () => {
  it("maps every status to a distinct tone", () => {
    const tones = new Set(
      (["pending", "delivering", "succeeded", "failed"] as const).map(deliveryStatusTone),
    );
    expect(tones.size).toBe(4);
    expect(deliveryStatusTone("succeeded")).toContain("success");
    expect(deliveryStatusTone("failed")).toContain("destructive");
  });
});

describe("truncate", () => {
  it("keeps short strings intact", () => {
    expect(truncate("hello", 10)).toBe("hello");
    expect(truncate("hello", 5)).toBe("hello");
  });

  it("cuts long strings with an ellipsis within the budget", () => {
    expect(truncate("hello world", 6)).toBe("hello…");
    expect(truncate("hello world", 6).length).toBe(6);
  });
});

describe("withAppQuery", () => {
  it("appends the app param", () => {
    expect(withAppQuery("/endpoints", "acme")).toBe("/endpoints?app=acme");
  });

  it("preserves existing query params", () => {
    expect(withAppQuery("/messages?tab=x", "acme")).toBe("/messages?tab=x&app=acme");
  });

  it("encodes the app key", () => {
    expect(withAppQuery("/", "a b")).toBe("/?app=a+b");
  });

  it("leaves the path untouched without an app (portal mode)", () => {
    expect(withAppQuery("/endpoints", "")).toBe("/endpoints");
  });
});

describe("groupEventTypes", () => {
  it("groups by groupName, sorted, ungrouped last", () => {
    const groups = groupEventTypes([
      { name: "user.created", groupName: "Users" },
      { name: "invoice.paid", groupName: "Billing" },
      { name: "ping" },
      { name: "invoice.voided", groupName: "Billing" },
    ]);
    expect(groups.map((g) => g.group)).toEqual(["Billing", "Users", "Ungrouped"]);
    expect(groups[0]?.types.map((t) => t.name)).toEqual(["invoice.paid", "invoice.voided"]);
    expect(groups[2]?.types.map((t) => t.name)).toEqual(["ping"]);
  });

  it("returns an empty list for an empty catalog", () => {
    expect(groupEventTypes([])).toEqual([]);
  });
});

describe("successRate", () => {
  it("is null with no terminal deliveries", () => {
    expect(successRate(0, 0)).toBeNull();
  });

  it("computes a rounded percentage", () => {
    expect(successRate(3, 1)).toBe(75);
    expect(successRate(1, 2)).toBe(33);
    expect(successRate(5, 0)).toBe(100);
  });
});

describe("withinWindow", () => {
  const now = Date.parse("2026-07-04T12:00:00.000Z");

  it("accepts timestamps inside the window", () => {
    expect(withinWindow("2026-07-04T11:00:00.000Z", 86_400_000, now)).toBe(true);
  });

  it("rejects timestamps outside the window or in the future", () => {
    expect(withinWindow("2026-07-02T11:00:00.000Z", 86_400_000, now)).toBe(false);
    expect(withinWindow("2026-07-04T13:00:00.000Z", 86_400_000, now)).toBe(false);
  });

  it("rejects missing or invalid timestamps", () => {
    expect(withinWindow(undefined, 1000, now)).toBe(false);
    expect(withinWindow("garbage", 1000, now)).toBe(false);
  });
});
