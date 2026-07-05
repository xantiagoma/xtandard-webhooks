/**
 * Regression tests for the two issues found integrating v0.1.0 downstream.
 *
 * 1. Idempotency comparison must be key-order-insensitive, so a control store
 *    that canonicalizes jsonb key order (Postgres/Drizzle) does not turn an
 *    identical re-publish into a false IdempotencyConflictError.
 * 2. When a prebuilt `core` (with a split `queueStorage`) is supplied, the
 *    panel must honor it — claim-safe dispatch, no spurious warning, and no
 *    need to re-pass `storage`/`queueStorage` on the panel.
 *
 * @module
 */

import { describe, expect, it, vi } from "vitest";
import { canonicalStringify } from "../src/canonical.ts";
import { createWebhooksCore } from "../src/core.ts";
import { createFetchHandler } from "../src/server/create-fetch-handler.ts";
import { createMemoryStorage } from "../src/storage/memory.ts";
import type { WebhooksStorage } from "../src/storage/contract.ts";
import { withoutQueueCapability } from "./fixtures.ts";

/**
 * A storage that reorders object keys on round-trip, the way Postgres `jsonb`
 * does — wraps memory but re-parses stored values through a key-sorting pass so
 * reads come back canonicalized (and thus in a different order than written).
 */
function keyReorderingStorage(): WebhooksStorage {
  const base = createMemoryStorage();
  const reorder = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(reorder);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      out[k] = reorder((v as Record<string, unknown>)[k]);
    }
    return out;
  };
  return {
    setItem: (k, v) => base.setItem(k, v),
    removeItem: (k) => base.removeItem(k),
    getKeys: (p) => base.getKeys(p),
    async getItem<T>(k: string): Promise<T | null> {
      const v = await base.getItem<T>(k);
      return v === null ? null : (reorder(v) as T);
    },
  };
}

describe("canonicalStringify", () => {
  it("is key-order-insensitive but array-order-sensitive", () => {
    expect(canonicalStringify({ b: 1, a: 2 })).toBe(canonicalStringify({ a: 2, b: 1 }));
    expect(canonicalStringify({ x: { d: 1, c: 2 } })).toBe(
      canonicalStringify({ x: { c: 2, d: 1 } }),
    );
    expect(canonicalStringify([1, 2])).not.toBe(canonicalStringify([2, 1]));
    expect(canonicalStringify({ a: 1 })).not.toBe(canonicalStringify({ a: 2 }));
  });
});

describe("issue 1 — idempotency survives a key-reordering control store", () => {
  it("a re-publish with the same multi-key payload returns the original, not a conflict", async () => {
    const core = createWebhooksCore({ storage: keyReorderingStorage() });
    await core.createApplication({ key: "acme" });
    await core.upsertEventType({ name: "file.ready" });

    const payload = { fileId: "fil_1", name: "x.png", kind: "image" };
    const first = await core.publish("acme", {
      eventType: "file.ready",
      payload,
      idempotencyKey: "k",
    });
    // Second publish, same key + same payload — must dedupe, not throw.
    const second = await core.publish("acme", {
      eventType: "file.ready",
      payload,
      idempotencyKey: "k",
    });
    expect(second.deduplicated).toBe(true);
    expect(second.message.id).toBe(first.message.id);
  });

  it("still detects a genuinely different payload", async () => {
    const core = createWebhooksCore({ storage: keyReorderingStorage() });
    await core.createApplication({ key: "acme" });
    await core.upsertEventType({ name: "file.ready" });
    await core.publish("acme", {
      eventType: "file.ready",
      payload: { fileId: "fil_1", kind: "image" },
      idempotencyKey: "k",
    });
    await expect(
      core.publish("acme", {
        eventType: "file.ready",
        payload: { fileId: "fil_1", kind: "video" }, // genuinely different
        idempotencyKey: "k",
      }),
    ).rejects.toThrow("different payload");
  });
});

describe("issue 2 — the panel honors a prebuilt core's split storage", () => {
  it("claim-safe (no warning) when the core has a claim-capable queueStorage, without re-passing it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const control = withoutQueueCapability(createMemoryStorage(), { cas: false }); // no claimDue/CAS
      const queue = createMemoryStorage(); // claim-safe
      const core = createWebhooksCore({ storage: control, queueStorage: queue });

      // Only the core is passed — no storage/queueStorage repeated on the panel.
      const panel = createFetchHandler({ core });
      expect(panel.dispatcher).not.toBeNull();
      // The dispatcher claims over the core's queue (claim-safe) → no warning.
      expect(warn).not.toHaveBeenCalled();
      await panel.dispatcher?.stop();
    } finally {
      warn.mockRestore();
    }
  });

  it("still warns when the core's queueStorage itself is not claim-safe", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const control = withoutQueueCapability(createMemoryStorage(), { cas: false });
      const core = createWebhooksCore({ storage: control }); // queue defaults to control → not claim-safe
      const panel = createFetchHandler({ core });
      expect(warn.mock.calls.flat().join(" ")).toContain("without atomic claiming");
      await panel.dispatcher?.stop();
    } finally {
      warn.mockRestore();
    }
  });

  it("requires storage or a core", () => {
    expect(() => createFetchHandler({ dispatcher: false } as never)).toThrow(
      /requires either `storage` or a prebuilt `core`/,
    );
  });
});
