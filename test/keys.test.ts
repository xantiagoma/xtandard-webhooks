import { describe, expect, it } from "vitest";
import * as keys from "../src/keys.ts";

describe("keys", () => {
  it("builds the documented layout", () => {
    expect(keys.applicationsKey()).toBe("whk/applications");
    expect(keys.applicationMetaKey("acme")).toBe("whk/acme/metadata");
    expect(keys.eventTypesKey()).toBe("whk/event-types");
    expect(keys.eventTypeKey("invoice.paid")).toBe("whk/event-types/invoice.paid");
    expect(keys.endpointsKey("acme")).toBe("whk/acme/endpoints");
    expect(keys.endpointKey("acme", "ep_1")).toBe("whk/acme/endpoints/ep_1");
    expect(keys.messageKey("acme", "msg_1")).toBe("whk/acme/messages/msg_1");
    expect(keys.idempotencyKey("acme", "order-42")).toBe("whk/acme/idempotency/order-42");
    expect(keys.deliveryKey("acme", "dlv_1")).toBe("whk/acme/deliveries/dlv_1");
    expect(keys.byMessageKey("acme", "msg_1", "dlv_1")).toBe("whk/acme/by-message/msg_1/dlv_1");
    expect(keys.byEndpointKey("acme", "ep_1", "dlv_1")).toBe("whk/acme/by-endpoint/ep_1/dlv_1");
    expect(keys.auditLogKey("acme")).toBe("whk/acme/audit-log");
    expect(keys.applicationPrefix("acme")).toBe("whk/acme/");
  });

  it("zero-pads attempt numbers for lexicographic ordering", () => {
    expect(keys.attemptKey("acme", "dlv_1", 1)).toBe("whk/acme/attempts/dlv_1/0001");
    expect(keys.attemptKey("acme", "dlv_1", 12)).toBe("whk/acme/attempts/dlv_1/0012");
    expect(keys.attemptKey("acme", "dlv_1", 2) < keys.attemptKey("acme", "dlv_1", 10)).toBe(true);
  });

  it("due keys sort lexicographically = chronologically", () => {
    const early = keys.dueKey("acme", 1_720_000_000_000, "dlv_b");
    const late = keys.dueKey("acme", 1_720_000_000_001, "dlv_a");
    expect(early < late).toBe(true);
    expect(early).toBe("whk/acme/due/1720000000000~dlv_b");
    // Sub-13-digit timestamps are zero-padded so they still sort first.
    const tiny = keys.dueKey("acme", 5, "dlv_c");
    expect(tiny).toBe("whk/acme/due/0000000000005~dlv_c");
    expect(tiny < early).toBe(true);
  });

  it("parses due keys back", () => {
    const key = keys.dueKey("acme", 1_720_000_000_000, "dlv_a");
    expect(keys.parseDueKey(key)).toEqual({
      dueAtMillis: 1_720_000_000_000,
      deliveryId: "dlv_a",
    });
    expect(keys.parseDueKey("whk/acme/due/garbage")).toBeNull();
    expect(keys.parseDueKey("whk/acme/due/123~")).toBeNull();
  });

  it("extracts the last segment", () => {
    expect(keys.lastSegment("whk/acme/endpoints/ep_1")).toBe("ep_1");
    expect(keys.lastSegment("")).toBe("");
  });
});
