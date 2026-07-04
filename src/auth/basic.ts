/**
 * HTTP Basic authentication {@link AuthProvider}.
 *
 * Parses the `Authorization: Basic <base64>` header, looks the username up in a
 * configured user list, and verifies the supplied password using one of three
 * credential modes (in order of preference):
 *
 * 1. A custom `passwordVerifier(username, password)` callback — for delegating
 *    to your own user store.
 * 2. A `passwordHash` produced by {@link hashPassword} — scrypt with a random
 *    salt, verified in constant time. **Recommended for production.**
 * 3. A plain `password` field — **development only**. Never ship real
 *    credentials as plaintext; they are compared in constant time but stored as
 *    cleartext in your config.
 *
 * On success the matched user becomes a {@link Principal}; on any failure
 * (missing/malformed header, unknown user, bad password) `authenticate` returns
 * `null`. {@link AuthProvider.challenge} emits a `401` with a
 * `WWW-Authenticate: Basic realm="…"` header so browsers prompt for credentials.
 *
 * Password hashing uses Node's `node:crypto` `scrypt`, which is available in
 * both Node and Bun — no Bun-only APIs and no extra dependencies.
 *
 * @module
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import type { AuthProvider, Principal } from "./contract.ts";

/** scrypt key length (bytes) used by {@link hashPassword}. */
const KEY_LENGTH = 64;
/** Salt length (bytes) used by {@link hashPassword}. */
const SALT_LENGTH = 16;
/** Prefix identifying a {@link hashPassword} digest. */
const SCRYPT_PREFIX = "scrypt";

const scryptAsync = (password: string, salt: Buffer, keylen: number): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });

/** Lowercase hex encoding of a buffer. */
const toHex = (buf: Buffer): string => buf.toString("hex");

/**
 * Hash a password with scrypt and a fresh random salt.
 *
 * The returned string is self-describing and safe to store in config or a
 * database: `scrypt$<saltHex>$<hashHex>`. Pass it back to
 * {@link verifyPassword} (or supply it as a user's `passwordHash`) to check a
 * candidate password.
 *
 * @example
 * ```ts
 * const stored = await hashPassword("correct horse battery staple");
 * // → "scrypt$<32 hex chars>$<128 hex chars>"
 * ```
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(password, salt, KEY_LENGTH);
  return `${SCRYPT_PREFIX}$${toHex(salt)}$${toHex(derived)}`;
}

/**
 * Verify a candidate `password` against a digest produced by
 * {@link hashPassword}.
 *
 * Re-derives the scrypt hash using the stored salt and compares it to the stored
 * hash with `crypto.timingSafeEqual` (constant time). Returns `false` — rather
 * than throwing — for malformed or unrecognized digests.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== SCRYPT_PREFIX) return false;
  const saltHex = parts[1];
  const hashHex = parts[2];
  if (!saltHex || !hashHex) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  const derived = await scryptAsync(password, salt, expected.length);
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/** A configured user for {@link basicAuth}. */
export interface BasicAuthUser {
  /** The login name, matched against the Basic credentials. */
  username: string;
  /**
   * A digest produced by {@link hashPassword} (`scrypt$<salt>$<hash>`).
   * Preferred for production.
   */
  passwordHash?: string;
  /**
   * A plaintext password. **Development only** — prefer `passwordHash`. Compared
   * in constant time but stored as cleartext in your config.
   */
  password?: string;
  /** Roles attached to the resulting {@link Principal}. */
  roles?: string[];
  /** Email attached to the resulting {@link Principal}. */
  email?: string;
  /** Principal id. Defaults to {@link BasicAuthUser.username} when omitted. */
  id?: string;
}

/** Options for {@link basicAuth}. */
export interface BasicAuthOptions {
  /** The known users. */
  users: BasicAuthUser[];
  /**
   * Realm advertised in the `WWW-Authenticate` header on challenge.
   * @default "xtandard-webhooks"
   */
  realm?: string;
  /**
   * Custom verifier. When supplied it takes precedence over `passwordHash` and
   * `password` for matched users — delegate to your own credential store and
   * return `true` to accept.
   */
  passwordVerifier?: (username: string, password: string) => Promise<boolean> | boolean;
}

/** Constant-time string comparison that does not leak length via early exit. */
function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  // timingSafeEqual requires equal lengths; hash to a fixed width first so the
  // comparison time does not depend on the inputs.
  if (bufA.length !== bufB.length) {
    // Still perform a comparison to keep timing uniform, then fail.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/** Result of parsing an `Authorization: Basic` header. */
interface BasicCredentials {
  username: string;
  password: string;
}

/** Decode the `Authorization: Basic <base64>` header, or `null` if absent/malformed. */
function parseBasicHeader(request: Request): BasicCredentials | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, encoded] = header.split(" ", 2);
  if (!scheme || scheme.toLowerCase() !== "basic" || !encoded) return null;

  let decoded: string;
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return null;
  }
  const sep = decoded.indexOf(":");
  if (sep < 0) return null;
  return { username: decoded.slice(0, sep), password: decoded.slice(sep + 1) };
}

/** Build the {@link Principal} for a successfully authenticated user. */
function principalFor(user: BasicAuthUser): Principal {
  return {
    id: user.id ?? user.username,
    name: user.username,
    ...(user.email !== undefined ? { email: user.email } : {}),
    ...(user.roles !== undefined ? { roles: user.roles } : {}),
  };
}

/**
 * Create an HTTP Basic {@link AuthProvider}.
 *
 * @example
 * ```ts
 * import { basicAuth, hashPassword } from "@xtandard/webhooks/auth/basic";
 *
 * const auth = basicAuth({
 *   realm: "Webhooks Admin",
 *   users: [
 *     { username: "admin", passwordHash: await hashPassword("s3cret"), roles: ["admin"] },
 *   ],
 * });
 * ```
 */
export function basicAuth(options: BasicAuthOptions): AuthProvider {
  const realm = options.realm ?? "xtandard-webhooks";
  const usersByName = new Map<string, BasicAuthUser>();
  for (const user of options.users) usersByName.set(user.username, user);

  return {
    async authenticate(request: Request): Promise<Principal | null> {
      const creds = parseBasicHeader(request);
      if (!creds) return null;

      const user = usersByName.get(creds.username);
      if (!user) {
        // Run a dummy verification to keep timing roughly uniform for unknown
        // users versus known users.
        if (options.passwordVerifier) {
          await options.passwordVerifier(creds.username, creds.password);
        }
        return null;
      }

      // (a) custom verifier wins.
      if (options.passwordVerifier) {
        const ok = await options.passwordVerifier(creds.username, creds.password);
        return ok ? principalFor(user) : null;
      }

      // (b) scrypt hash.
      if (user.passwordHash !== undefined) {
        const ok = await verifyPassword(creds.password, user.passwordHash);
        return ok ? principalFor(user) : null;
      }

      // (c) dev-only plaintext.
      if (user.password !== undefined) {
        const ok = constantTimeEquals(creds.password, user.password);
        return ok ? principalFor(user) : null;
      }

      return null;
    },

    challenge(_request: Request): Response {
      return new Response("Unauthorized", {
        status: 401,
        headers: { "WWW-Authenticate": `Basic realm="${realm}"` },
      });
    },
  };
}
