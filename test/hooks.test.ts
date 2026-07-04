import { describe, expect, it } from "vitest";
import {
  defaultHookErrorReporter,
  HookDeniedError,
  normalizeHooks,
  runAfter,
  runBefore,
  type AfterEvent,
  type BeforeEvent,
  type WebhooksHooks,
} from "../src/hooks/contract.ts";
import { createLogHook } from "../src/hooks/log.ts";

const beforeEvent: BeforeEvent = {
  type: "application.create",
  application: { key: "acme" },
  actor: null,
};
const afterEvent: AfterEvent = {
  type: "application.created",
  application: { key: "acme" },
  at: "2026-07-04T12:00:00.000Z",
};

describe("normalizeHooks", () => {
  it("handles undefined, single, and array inputs", () => {
    expect(normalizeHooks(undefined)).toEqual([]);
    const hook: WebhooksHooks = { after: () => {} };
    expect(normalizeHooks(hook)).toEqual([hook]);
    expect(normalizeHooks([hook, hook])).toEqual([hook, hook]);
  });
});

describe("runBefore", () => {
  it("runs sequentially and stops at the first throw", async () => {
    const calls: number[] = [];
    const hooks: WebhooksHooks[] = [
      { before: () => void calls.push(1) },
      {
        before: () => {
          calls.push(2);
          throw new HookDeniedError("no");
        },
      },
      { before: () => void calls.push(3) },
    ];
    await expect(runBefore(hooks, beforeEvent)).rejects.toThrow("no");
    expect(calls).toEqual([1, 2]);
  });
});

describe("runAfter", () => {
  it("isolates failures and still runs the rest", async () => {
    const calls: string[] = [];
    const errors: unknown[] = [];
    const hooks: WebhooksHooks[] = [
      {
        after: () => {
          throw new Error("boom");
        },
      },
      { after: () => void calls.push("ok") },
    ];
    await runAfter(hooks, afterEvent, (error) => void errors.push(error));
    expect(calls).toEqual(["ok"]);
    expect(errors).toHaveLength(1);
  });

  it("defaultHookErrorReporter never throws", () => {
    expect(() => defaultHookErrorReporter(new Error("x"), afterEvent)).not.toThrow();
  });
});

describe("HookDeniedError", () => {
  it("carries a status and sets name for cross-bundle detection", () => {
    const err = new HookDeniedError("frozen", { status: 429 });
    expect(err.status).toBe(429);
    expect(err.name).toBe("HookDeniedError");
    expect(new HookDeniedError("x").status).toBe(403);
  });

  it("is detectable by err.name even when instanceof fails (re-imported copy)", () => {
    // Simulate the dual-bundle case: a structurally identical error class from
    // "another copy" of the package. Routes must fall back to `err.name`.
    class ForeignHookDeniedError extends Error {
      readonly status = 403;
      constructor(message: string) {
        super(message);
        this.name = "HookDeniedError";
      }
    }
    const foreign: unknown = new ForeignHookDeniedError("denied elsewhere");
    expect(foreign instanceof HookDeniedError).toBe(false);
    expect((foreign as Error).name).toBe("HookDeniedError");
  });
});

describe("createLogHook", () => {
  it("logs after events with the package prefix", async () => {
    const lines: string[] = [];
    const hook = createLogHook({ log: (l) => void lines.push(l) });
    await hook.after?.(afterEvent);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[@xtandard/webhooks] after application.created");
    expect(hook.before).toBeUndefined();
  });

  it("optionally logs before events and never denies", async () => {
    const lines: string[] = [];
    const hook = createLogHook({ log: (l) => void lines.push(l), includeBefore: true });
    await expect(Promise.resolve(hook.before?.(beforeEvent))).resolves.toBeUndefined();
    expect(lines[0]).toContain("before application.create");
  });

  it("supports a custom format", async () => {
    const lines: string[] = [];
    const hook = createLogHook({
      log: (l) => void lines.push(l),
      format: (phase, event) => `${phase}!${event.type}`,
    });
    await hook.after?.(afterEvent);
    expect(lines).toEqual(["after!application.created"]);
  });
});
