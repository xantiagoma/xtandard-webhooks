import { describe, expect, it } from "vitest";
import { attemptDelivery } from "../src/deliver.ts";
import { generateSecret } from "../src/signing.ts";
import type { Endpoint } from "../src/schema.ts";

/** Cast a plain responder to the `typeof fetch` the delivery input expects. */
const ff = (
  fn: (url: string | URL | Request, init?: RequestInit) => Promise<Response>,
): typeof fetch => fn as unknown as typeof fetch;

const endpoint = (): Endpoint =>
  ({
    id: "ep_1",
    url: "https://api.example.com/hooks",
    secrets: [{ secret: generateSecret(), createdAt: "2020-01-01T00:00:00.000Z" }],
  }) as Endpoint;

describe("attemptDelivery outcomes", () => {
  it("2xx with a body → ok", async () => {
    const out = await attemptDelivery({
      endpoint: endpoint(),
      messageId: "msg_1",
      body: "{}",
      fetch: ff(async () => new Response("received", { status: 202 })),
    });
    expect(out.ok).toBe(true);
    expect(out.httpStatus).toBe(202);
    expect(out.responseBody).toBe("received");
  });

  it("non-2xx with an empty body → failed, responseBody omitted", async () => {
    const out = await attemptDelivery({
      endpoint: endpoint(),
      messageId: "msg_1",
      body: "{}",
      fetch: ff(async () => new Response("", { status: 500 })),
    });
    expect(out.ok).toBe(false);
    expect(out.httpStatus).toBe(500);
    expect(out.responseBody).toBeUndefined();
  });

  it("truncates a large response body", async () => {
    const out = await attemptDelivery({
      endpoint: endpoint(),
      messageId: "msg_1",
      body: "{}",
      responseBodyLimit: 10,
      fetch: ff(async () => new Response("x".repeat(1000), { status: 400 })),
    });
    expect(out.responseBody?.length).toBe(10);
  });

  it("a rejecting fetch (Error) is recorded as a failed attempt", async () => {
    const out = await attemptDelivery({
      endpoint: endpoint(),
      messageId: "msg_1",
      body: "{}",
      fetch: ff(async () => {
        throw new Error("ECONNREFUSED");
      }),
    });
    expect(out.ok).toBe(false);
    expect(out.httpStatus).toBeUndefined();
    expect(out.error).toContain("ECONNREFUSED");
  });

  it("a non-Error thrown value is stringified", async () => {
    const out = await attemptDelivery({
      endpoint: endpoint(),
      messageId: "msg_1",
      body: "{}",
      fetch: ff(async () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "boom-string";
      }),
    });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("boom-string");
  });

  it("a timeout aborts and is reported as a timeout", async () => {
    const out = await attemptDelivery({
      endpoint: endpoint(),
      messageId: "msg_1",
      body: "{}",
      timeoutMs: 5,
      fetch: ff(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            (init?.signal as AbortSignal | undefined)?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      ),
    });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("Timed out");
  });

  it("a body that fails to read does not change the verdict", async () => {
    const fakeResponse = {
      status: 200,
      text: async () => {
        throw new Error("stream closed");
      },
    } as unknown as Response;
    const out = await attemptDelivery({
      endpoint: endpoint(),
      messageId: "msg_1",
      body: "{}",
      fetch: ff(async () => fakeResponse),
    });
    expect(out.ok).toBe(true);
    expect(out.responseBody).toBeUndefined();
  });

  it("defaults nowMs to the wall clock when omitted", async () => {
    const before = Date.now();
    const out = await attemptDelivery({
      endpoint: endpoint(),
      messageId: "msg_1",
      body: "{}",
      fetch: ff(async () => new Response("ok")),
    });
    expect(Date.parse(out.at)).toBeGreaterThanOrEqual(before - 1000);
  });
});
