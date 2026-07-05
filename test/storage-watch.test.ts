import { describe, expect, it } from "vitest";
import { pgListenNotify, withWatch, type PgNotificationClient } from "../src/storage/watch.ts";
import { isWatchable } from "../src/storage/contract.ts";
import { createMemoryStorage } from "../src/storage/memory.ts";

describe("withWatch", () => {
  it("adds a watch() to a storage from a custom change source, filtered by prefix", async () => {
    const base = createMemoryStorage();
    let notify: ((key?: string) => void) | undefined;
    const watched = withWatch(base, (n) => {
      notify = n;
      return () => {};
    });
    expect(isWatchable(watched)).toBe(true);
    // Delegates reads/writes to the wrapped storage.
    await watched.setItem("whk/acme/a", 1);
    expect(await watched.getItem("whk/acme/a")).toBe(1);

    const events: string[] = [];
    await watched.watch("whk/acme/", (e) => events.push(`${e.type}:${e.key}`));
    notify?.("whk/acme/a"); // under prefix → delivered
    notify?.("whk/other/b"); // outside prefix → filtered out
    notify?.(); // no key → delivered as a change to the prefix itself
    expect(events).toEqual(["update:whk/acme/a", "update:whk/acme/"]);
  });

  it("supports an async subscribe and returns its unsubscribe", async () => {
    const base = createMemoryStorage();
    let unsubscribed = false;
    const watched = withWatch(base, async () => () => {
      unsubscribed = true;
    });
    const off = await watched.watch("whk/", () => {});
    await off();
    expect(unsubscribed).toBe(true);
  });
});

describe("pgListenNotify", () => {
  it("LISTENs on the channel and delivers matching notifications", async () => {
    const queries: string[] = [];
    let listener: ((msg: { channel: string; payload?: string }) => void) | undefined;
    const client: PgNotificationClient = {
      async query(sql: string) {
        queries.push(sql);
        return undefined;
      },
      on(_event, l) {
        listener = l;
      },
      removeListener() {
        listener = undefined;
      },
    };

    const base = createMemoryStorage();
    const watched = withWatch(base, pgListenNotify(client, "xtandard_webhooks"));
    const keys: string[] = [];
    const off = await watched.watch("whk/acme/", (e) => keys.push(e.key));

    expect(queries.some((q) => q.includes('LISTEN "xtandard_webhooks"'))).toBe(true);
    // A notification on the right channel + matching prefix is delivered;
    // a foreign channel is ignored.
    listener?.({ channel: "xtandard_webhooks", payload: "whk/acme/endpoints/ep_1" });
    listener?.({ channel: "some_other_channel", payload: "whk/acme/x" });
    expect(keys).toEqual(["whk/acme/endpoints/ep_1"]);

    await off();
    expect(queries.some((q) => q.includes("UNLISTEN"))).toBe(true);
    expect(listener).toBeUndefined();
  });
});
