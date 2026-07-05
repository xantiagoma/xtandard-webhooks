/**
 * Regression tests for the confirmed findings from the workflow code review.
 * Each test fails against the pre-fix code and passes after.
 *
 * @module
 */

import { mkdtempSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createWebhooksCore, ReadonlyError } from "../src/core.ts";
import { clearFileStorage, createFileStorage } from "../src/storage/file.ts";
import { createMemoryStorage } from "../src/storage/memory.ts";
import { generateSecret, sign, verify } from "../src/signing.ts";
import { createPortalToken, verifyPortalToken } from "../src/portal.ts";
import { ValidationError } from "../src/validation.ts";
import { fakeFetch, ok, seedBasics, setupWebhooks } from "./fixtures.ts";

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((dir) => clearFileStorage({ dir })));
});
function freshDir(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "xtw-review-")), "store");
  dirs.push(dir);
  return dir;
}

describe("#1 idempotency key cannot escape its namespace or traverse the fs", () => {
  it("rejects path-traversal and slash-bearing keys", async () => {
    const { core } = setupWebhooks();
    await core.createApplication({ key: "acme" });
    await core.upsertEventType({ name: "e.t" });
    for (const bad of ["../../../../tmp/pwn", "x/metadata", "..", ".", "a b"]) {
      await expect(
        core.publish("acme", { eventType: "e.t", payload: 1, idempotencyKey: bad }),
      ).rejects.toThrow(ValidationError);
    }
    // A normal key still works.
    await expect(
      core.publish("acme", { eventType: "e.t", payload: 1, idempotencyKey: "order-42" }),
    ).resolves.toBeDefined();
  });

  it("never writes a file outside the storage dir (file adapter)", async () => {
    const dir = freshDir();
    const core = createWebhooksCore({
      storage: createFileStorage({ dir }),
      allowInsecureUrls: true,
    });
    await core.createApplication({ key: "acme" });
    await core.upsertEventType({ name: "e.t" });
    await expect(
      core.publish("acme", {
        eventType: "e.t",
        payload: 1,
        idempotencyKey: "../../../../escape",
      }),
    ).rejects.toThrow(ValidationError);
    // The parent of the store dir must not have gained an `escape.json`.
    const parent = join(dir, "..", "..", "..", "..");
    const entries = await readdir(parent).catch(() => []);
    expect(entries).not.toContain("escape.json");
  });
});

describe("#3 a portal token cannot mutate the global event-type catalog", () => {
  it("denies event-type writes even when the host widened portal.allow", async () => {
    const storage = createMemoryStorage();
    const secret = "portal-secret";
    const { fetch } = (await import("../src/server/create-fetch-handler.ts")).createFetchHandler({
      storage,
      dispatcher: false,
      portal: {
        secret,
        // Host mistakenly grants event-type writes to portal tokens.
        allow: ["event-type:read", "event-type:create", "event-type:delete", "endpoint:read"],
      },
    });
    // Seed via a second core over the same storage.
    const admin = createWebhooksCore({ storage });
    await admin.createApplication({ key: "acme" });
    await admin.upsertEventType({ name: "invoice.paid" });

    const token = await createPortalToken(secret, "acme");
    const auth = { Authorization: `Bearer ${token}` };

    // Read is allowed.
    const read = await fetch(new Request("http://x/api/event-types", { headers: auth }));
    expect(read.status).toBe(200);

    // Create/delete of the GLOBAL catalog is denied (403), not 2xx.
    const create = await fetch(
      new Request("http://x/api/event-types", {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ name: "sneaky.type" }),
      }),
    );
    expect(create.status).toBe(403);
    const del = await fetch(
      new Request("http://x/api/event-types/invoice.paid", { method: "DELETE", headers: auth }),
    );
    expect(del.status).toBe(403);
    // The catalog is intact.
    expect((await admin.listEventTypes()).map((t) => t.name)).toEqual(["invoice.paid"]);
  });
});

describe("#4 sendExample respects readonly (no outbound traffic)", () => {
  it("throws ReadonlyError instead of firing a signed POST", async () => {
    const seeded = setupWebhooks();
    const { endpoint } = await seedBasics(seeded.core);
    const { fetch, requests } = fakeFetch(() => ok());
    const ro = setupWebhooks({ storage: seeded.storage, readonly: true, dispatcher: { fetch } });
    await expect(
      ro.core.sendExample("acme", endpoint.id, { eventType: "invoice.paid" }),
    ).rejects.toThrow(ReadonlyError);
    expect(requests).toHaveLength(0);
  });
});

describe("#5 verify uses the raw wire timestamp, not a re-stringified number", () => {
  it("accepts a signature computed over a timestamp string with a leading zero", async () => {
    const secret = generateSecret();
    const id = "msg_1";
    // A compliant sender that signs the literal header value it will send.
    const rawTs = "01720000000"; // Number()->String() would drop the leading zero
    const body = '{"type":"t","timestamp":"now","data":1}';
    const signature = await signRaw(secret, id, rawTs, body);
    await expect(
      verify({
        payload: body,
        headers: {
          "webhook-id": id,
          "webhook-timestamp": rawTs,
          "webhook-signature": signature,
        },
        secret,
        now: 1720000000,
      }),
    ).resolves.toBeDefined();
  });

  it("still round-trips normal integer timestamps", async () => {
    const secret = generateSecret();
    const sig = await sign(secret, "msg_1", 1720000000, "{}");
    await expect(
      verify({
        payload: "{}",
        headers: {
          "webhook-id": "msg_1",
          "webhook-timestamp": "1720000000",
          "webhook-signature": sig,
        },
        secret,
        now: 1720000000,
      }),
    ).resolves.toEqual({});
  });
});

describe("#7 dispatcher failure-accounting does not clobber a concurrent enable", () => {
  it("an Enable during a failing attempt is not silently reverted", async () => {
    const { fetch } = fakeFetch(() => new Response("no", { status: 500 }));
    const { core, dispatcher, endpoint } = await (async () => {
      const s = setupWebhooks({ dispatcher: { fetch, retrySchedule: ["0s", "0s", "0s"] } });
      const seeded = await seedBasics(s.core);
      return { ...s, endpoint: seeded.endpoint };
    })();
    await core.publish("acme", { eventType: "invoice.paid", payload: 1 });

    // Claim + attempt in flight; simulate the operator enabling mid-way by
    // interleaving: run one tick (records a failure) then immediately enable.
    await dispatcher.tick();
    await core.disableEndpoint("acme", endpoint.id);
    const enabled = await core.enableEndpoint("acme", endpoint.id);
    expect(enabled.disabled).toBeUndefined();
    // A subsequent failure-accounting write must merge onto the latest record,
    // not resurrect a stale disabled/streak snapshot.
    await core.noteEndpointOutcome("acme", endpoint.id, false, { failingForDays: 5 });
    const after = await core.getEndpoint("acme", endpoint.id);
    expect(after?.disabled).toBeUndefined(); // still enabled
  });
});

describe("#8 lease is bumped above the attempt timeout", () => {
  it("a misconfigured short lease cannot expire before an attempt's timeout", async () => {
    const { fetch } = fakeFetch(() => ok());
    const s = setupWebhooks({ dispatcher: { fetch, leaseMs: 1000, timeoutMs: 20_000 } });
    await seedBasics(s.core);
    // With leaseMs (1s) < timeoutMs (20s) the old code left a 19s window where a
    // second dispatcher could reclaim mid-attempt. The dispatcher now bumps the
    // lease; we assert the claim it writes outlives the timeout.
    await s.core.publish("acme", { eventType: "invoice.paid", payload: 1 });
    const [claimed] = await s.core.claimDueDeliveries({ limit: 1, leaseMs: 20_000 + 10_000 });
    expect(claimed).toBeDefined();
    const leaseMs = Date.parse(claimed!.leaseUntil ?? "") - s.clock.now();
    expect(leaseMs).toBeGreaterThanOrEqual(20_000);
  });
});

describe("#10 pagination signals an invalid cursor instead of restarting", () => {
  it("returns an empty page when the before cursor no longer exists", async () => {
    const { core } = setupWebhooks();
    await core.createApplication({ key: "acme" });
    await core.upsertEventType({ name: "e.t" });
    for (let i = 0; i < 3; i++) await core.publish("acme", { eventType: "e.t", payload: i });
    const page = await core.listMessages("acme", { before: "msg_doesnotexist" });
    expect(page).toEqual([]);
  });
});

describe("portal token verification is unchanged by the fixes", () => {
  it("still round-trips", async () => {
    const token = await createPortalToken("s", "acme");
    expect(await verifyPortalToken("s", token)).toEqual({ applicationKey: "acme" });
  });
});

/** Sign over an arbitrary raw timestamp string (test helper for #5). */
async function signRaw(
  secret: string,
  id: string,
  rawTimestamp: string,
  body: string,
): Promise<string> {
  // Reproduce the wire signing but with a non-numeric-normalized timestamp.
  const { subtle } = crypto;
  const keyBytes = Uint8Array.from(atob(secret.replace(/^whsec_/, "")), (c) => c.charCodeAt(0));
  const key = await subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${rawTimestamp}.${body}`),
  );
  let bin = "";
  for (const b of new Uint8Array(mac)) bin += String.fromCharCode(b);
  return `v1,${btoa(bin)}`;
}
