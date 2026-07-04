import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.ts";

let dir: string;
let out: string[];
let err: string[];

const ENV = [
  "STORAGE_DRIVER",
  "QUEUE_STORAGE_DRIVER",
  "STORAGE_FILE_DIR",
  "QUEUE_FILE_DIR",
  "MESSAGE_KEEP_LAST",
  "MESSAGE_MAX_AGE",
  "AUDIT_KEEP_LAST",
  "AUDIT_MAX_AGE",
  "RETRY_SCHEDULE",
  "APP",
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "webhooks-cli-"));
  for (const k of ENV) saved[k] = process.env[k];
  process.env.STORAGE_DRIVER = "file";
  process.env.STORAGE_FILE_DIR = join(dir, "storage");
  out = [];
  err = [];
  vi.spyOn(process.stdout, "write").mockImplementation((s) => (out.push(String(s)), true));
  vi.spyOn(process.stderr, "write").mockImplementation((s) => (err.push(String(s)), true));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("cli basics", () => {
  test("help exits 0 with --help, 1 with no command", async () => {
    expect(await run(["--help"])).toBe(0);
    expect(await run([])).toBe(1);
  });

  test("--help documents the commands and the env contract", async () => {
    expect(await run(["--help"])).toBe(0);
    const help = out.join("");
    for (const token of [
      "serve",
      "dispatch",
      "publish",
      "verify",
      "DISPATCHER",
      "RETRY_SCHEDULE",
      "PORTAL_SECRET",
      "MESSAGE_KEEP_LAST",
      "AUTH_MODE",
      "-v, --version",
      "Examples:",
    ]) {
      expect(help).toContain(token);
    }
  });

  test("--version / -v print a semver and exit 0", async () => {
    expect(await run(["--version"])).toBe(0);
    expect(out.join("")).toMatch(/\d+\.\d+\.\d+/);
    out.length = 0;
    expect(await run(["-v"])).toBe(0);
    expect(out.join("")).toMatch(/\d+\.\d+\.\d+/);
  });

  test("unknown command exits 1", async () => {
    expect(await run(["frobnicate"])).toBe(1);
    expect(err.join("")).toContain("Unknown command");
  });

  test("help command exits 0 and prints usage", async () => {
    expect(await run(["help"])).toBe(0);
    expect(out.join("")).toContain("xtandard-webhooks");
  });
});

describe("cli init / list", () => {
  test("init creates the application + example event type; list-apps shows it", async () => {
    expect(await run(["init"])).toBe(0);
    expect(out.join("")).toContain('Initialized application "default"');
    out.length = 0;
    expect(await run(["list-apps"])).toBe(0);
    expect(out.join("")).toContain("default");
  });

  test("init respects --app and is idempotent", async () => {
    expect(await run(["init", "--app", "acme"])).toBe(0);
    expect(await run(["init", "--app", "acme"])).toBe(0); // existing app → no conflict
    out.length = 0;
    expect(await run(["list-apps"])).toBe(0);
    expect(out.join("")).toContain("acme");
  });

  test("list-apps with no applications says so", async () => {
    expect(await run(["list-apps"])).toBe(0);
    expect(out.join("")).toContain("No applications.");
  });

  test("list-endpoints without --app exits 1 with usage", async () => {
    expect(await run(["list-endpoints"])).toBe(1);
    expect(err.join("")).toContain("Usage");
  });

  test("list-endpoints renders endpoints (and says so when empty)", async () => {
    await run(["init", "--app", "acme"]);
    out.length = 0;
    expect(await run(["list-endpoints", "--app", "acme"])).toBe(0);
    expect(out.join("")).toContain("No endpoints.");
    const endpoint = await seedEndpoint("acme");
    out.length = 0;
    expect(await run(["list-endpoints", "--app", "acme"])).toBe(0);
    const text = out.join("");
    expect(text).toContain(endpoint.id);
    expect(text).toContain("https://acme.example.com/hooks");
    expect(text).toContain("●"); // enabled marker
  });
});

describe("cli publish / retry", () => {
  test("publish without required flags exits 1 with usage", async () => {
    expect(await run(["publish", "--app", "acme"])).toBe(1);
    expect(err.join("")).toContain("Usage");
  });

  test("publish with invalid --data JSON exits 1", async () => {
    await run(["init", "--app", "acme"]);
    err.length = 0;
    expect(
      await run(["publish", "--app", "acme", "--type", "example.ping", "--data", "{not json"]),
    ).toBe(1);
    expect(err.join("")).toContain("Invalid --data JSON");
  });

  test("publish with an unknown event type exits 1 (mapped error)", async () => {
    await run(["init", "--app", "acme"]);
    err.length = 0;
    expect(await run(["publish", "--app", "acme", "--type", "no.such.event", "--data", "{}"])).toBe(
      1,
    );
    expect(err.join("")).toContain("Error:");
  });

  test("publish fans out to a subscribed endpoint; idempotency key dedupes", async () => {
    await run(["init", "--app", "acme"]);
    await seedEndpoint("acme");
    out.length = 0;
    expect(
      await run([
        "publish",
        "--app",
        "acme",
        "--type",
        "example.ping",
        "--data",
        '{"hello":"world"}',
        "--idempotency-key",
        "k1",
      ]),
    ).toBe(0);
    expect(out.join("")).toMatch(/Published msg_\S+ → 1 delivery queued\./);
    out.length = 0;
    expect(
      await run([
        "publish",
        "--app",
        "acme",
        "--type",
        "example.ping",
        "--data",
        '{"hello":"world"}',
        "--idempotency-key",
        "k1",
      ]),
    ).toBe(0);
    expect(out.join("")).toContain("Deduplicated");
  });

  test("retry without required flags exits 1 with usage", async () => {
    expect(await run(["retry", "--app", "acme"])).toBe(1);
    expect(err.join("")).toContain("Usage");
  });

  test("retry of a missing delivery exits 1 (mapped error)", async () => {
    await run(["init", "--app", "acme"]);
    err.length = 0;
    expect(await run(["retry", "--app", "acme", "--delivery", "del_nope"])).toBe(1);
    expect(err.join("")).toContain("Error:");
  });
});

describe("cli verify", () => {
  test("verify without required flags exits 1 with usage", async () => {
    expect(await run(["verify", "--secret", "whsec_x"])).toBe(1);
    expect(err.join("")).toContain("Usage");
  });

  test("verify accepts a correctly signed payload and prints the envelope", async () => {
    const { secret, payloadFile, headersFile } = await writeSignedFixture();
    expect(
      await run([
        "verify",
        "--secret",
        secret,
        "--payload-file",
        payloadFile,
        "--headers-file",
        headersFile,
      ]),
    ).toBe(0);
    const text = out.join("");
    expect(text).toContain("Signature OK.");
    expect(text).toContain('"invoice.paid"');
  });

  test("verify rejects a tampered payload and exits 1", async () => {
    const { secret, headersFile } = await writeSignedFixture();
    const tampered = join(dir, "tampered.json");
    await writeFile(
      tampered,
      JSON.stringify({ type: "invoice.paid", timestamp: NOW_ISO, data: { amount: 999_999 } }),
    );
    expect(
      await run([
        "verify",
        "--secret",
        secret,
        "--payload-file",
        tampered,
        "--headers-file",
        headersFile,
      ]),
    ).toBe(1);
    expect(err.join("")).toContain("Verification FAILED");
  });

  test("verify with a malformed headers file exits 1", async () => {
    const { secret, payloadFile } = await writeSignedFixture();
    const bad = join(dir, "bad-headers.json");
    await writeFile(bad, "{not json");
    expect(
      await run([
        "verify",
        "--secret",
        secret,
        "--payload-file",
        payloadFile,
        "--headers-file",
        bad,
      ]),
    ).toBe(1);
    expect(err.join("")).toContain("Invalid --headers-file");
  });
});

describe("cli env parsing", () => {
  test("invalid retention numbers/durations warn and are ignored", async () => {
    process.env.MESSAGE_KEEP_LAST = "lots";
    process.env.MESSAGE_MAX_AGE = "soon";
    expect(await run(["init"])).toBe(0);
    const text = err.join("");
    expect(text).toContain('Ignoring MESSAGE_KEEP_LAST="lots"');
    expect(text).toContain('Ignoring MESSAGE_MAX_AGE="soon"');
  });

  test("valid retention env is accepted silently", async () => {
    process.env.MESSAGE_KEEP_LAST = "100";
    process.env.MESSAGE_MAX_AGE = "30d";
    process.env.AUDIT_KEEP_LAST = "500";
    process.env.AUDIT_MAX_AGE = "90d";
    expect(await run(["init"])).toBe(0);
    expect(err.join("")).not.toContain("Ignoring");
  });

  test("invalid RETRY_SCHEDULE warns and is ignored", async () => {
    process.env.RETRY_SCHEDULE = "0s,sometimes,5m";
    expect(await run(["init"])).toBe(0);
    expect(err.join("")).toContain('Ignoring RETRY_SCHEDULE="0s,sometimes,5m"');
  });

  test("valid RETRY_SCHEDULE is accepted silently", async () => {
    process.env.RETRY_SCHEDULE = "0s,5s,5m,30m,2h,5h,10h";
    expect(await run(["init"])).toBe(0);
    expect(err.join("")).not.toContain("Ignoring RETRY_SCHEDULE");
  });

  test("memory driver path works for init", async () => {
    process.env.STORAGE_DRIVER = "memory";
    expect(await run(["init"])).toBe(0);
    expect(out.join("")).toContain("Initialized");
  });
});

const NOW_ISO = new Date().toISOString();

/**
 * The CLI has no "create endpoint" command, so tests seed one directly via a
 * core built over the same file storage the CLI uses (matching the env vars
 * set in beforeEach).
 */
async function seedEndpoint(app: string) {
  const { createWebhooksCore } = await import("../src/core.ts");
  const { createFileStorage } = await import("../src/storage/file.ts");
  const storage = createFileStorage({ dir: process.env.STORAGE_FILE_DIR! });
  const core = createWebhooksCore({ storage });
  return core.createEndpoint(app, {
    url: "https://acme.example.com/hooks",
    eventTypes: ["example.ping"],
  });
}

/** A signed Standard Webhooks request captured to disk (payload + headers files). */
async function writeSignedFixture() {
  const { generateSecret, sign } = await import("../src/signing.ts");
  const secret = generateSecret();
  const payload = JSON.stringify({
    type: "invoice.paid",
    timestamp: NOW_ISO,
    data: { invoiceId: "inv_1" },
  });
  const id = "msg_verifyfixture";
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await sign(secret, id, timestamp, payload);
  const payloadFile = join(dir, "payload.json");
  const headersFile = join(dir, "headers.json");
  await writeFile(payloadFile, payload);
  await writeFile(
    headersFile,
    JSON.stringify({
      "webhook-id": id,
      "webhook-timestamp": String(timestamp),
      "webhook-signature": signature,
    }),
  );
  return { secret, payloadFile, headersFile };
}
