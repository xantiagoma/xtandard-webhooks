/**
 * Auth + authorization flexibility demo. One server; `AUTH_DEMO` selects the mode:
 *
 *   AUTH_DEMO=none|basic|delegated|rbac bun run src/index.ts
 *
 * `none` (open), `basic` (hashed + plaintext passwords), `delegated`
 * (bring-your-own: an `X-API-Key` lookup in ~5 lines), and `rbac` (three users,
 * three roles, one policy). Whatever the mode, a **portal-token mint route**
 * (`POST /portal-token?app=acme`) runs side-by-side: your backend mints a
 * scoped `whpt_…` token with `createPortalToken` and hands it to a customer's
 * browser — the panel then confines that bearer to their own application.
 *
 * See ../README.md for curl commands per mode.
 */
import { createFetchHandler, createPortalToken } from "@xtandard/webhooks";
import type { AuthProvider, AuthorizationProvider, WebhooksAction } from "@xtandard/webhooks";
import { basicAuth, hashPassword } from "@xtandard/webhooks/auth/basic";
import { delegatedAuth } from "@xtandard/webhooks/auth/delegated";
import { noAuth } from "@xtandard/webhooks/auth/none";
import { noAuthorization } from "@xtandard/webhooks/authorization/none";
import { rolesAuthorization, type RolePolicy } from "@xtandard/webhooks/authorization/roles";
import { createMemoryStorage } from "@xtandard/webhooks/storage/memory";

// The portal secret NEVER reaches a browser — it only mints and verifies tokens.
const PORTAL_SECRET = process.env.PORTAL_SECRET ?? "demo-portal-secret-change-me";

// A 3-tier role policy: admin → anything; support → inspect + retry, but no
// endpoint management; viewer → read only. Authorization allows an action if
// ANY of the principal's roles grants it.
const READ_ONLY: WebhooksAction[] = [
  "application:read",
  "event-type:read",
  "endpoint:read",
  "message:read",
  "delivery:read",
  "audit:read",
];
const POLICY: RolePolicy = {
  admin: "*",
  support: [...READ_ONLY, "delivery:retry", "message:publish"],
  viewer: READ_ONLY,
};

/** Demo token → principal table for the `delegated` mode. */
const API_KEYS: Record<string, { id: string; name: string; roles: string[] }> = {
  "key-admin": { id: "alice", name: "Alice", roles: ["admin"] },
  "key-support": { id: "bob", name: "Bob", roles: ["support"] },
  "key-viewer": { id: "carol", name: "Carol", roles: ["viewer"] },
};

const mode = process.env.AUTH_DEMO ?? "rbac";
let auth: AuthProvider;
let authorization: AuthorizationProvider = rolesAuthorization({ policy: POLICY });

switch (mode) {
  case "none":
    auth = noAuth();
    authorization = noAuthorization(); // allow everything
    break;
  case "basic":
    auth = basicAuth({
      users: [
        // Encrypted (scrypt) — preferred. The stored value is a `scrypt$…` digest.
        { username: "admin", passwordHash: await hashPassword("s3cret"), roles: ["admin"] },
        // Plaintext — DEV ONLY. Never ship a real password as cleartext.
        { username: "dev", password: "dev", roles: ["admin"] },
      ],
    });
    break;
  case "delegated":
    // Bring-your-own authentication: an AuthProvider is just Request → Principal.
    auth = delegatedAuth({
      authenticate: (request) => {
        const key = request.headers.get("x-api-key");
        return key ? (API_KEYS[key] ?? null) : null;
      },
    });
    break;
  case "rbac":
    auth = basicAuth({
      users: [
        { username: "alice", passwordHash: await hashPassword("alice"), roles: ["admin"] },
        { username: "bob", passwordHash: await hashPassword("bob"), roles: ["support"] },
        { username: "carol", passwordHash: await hashPassword("carol"), roles: ["viewer"] },
      ],
    });
    break;
  default:
    console.error(`Unknown AUTH_DEMO="${mode}". Use: none|basic|delegated|rbac`);
    process.exit(1);
}

const panel = createFetchHandler({
  basePath: "",
  storage: createMemoryStorage(),
  title: `Auth demo: ${mode}`,
  auth,
  authorization,
  // Portal tokens compose with EVERY auth mode: a valid whpt_… bearer becomes
  // a portal principal scoped to its token's application.
  portal: { secret: PORTAL_SECRET },
});

// Seed one application + event type so there is something to look at (and for
// portal tokens to scope to).
await panel.core.createApplication({ key: "acme", name: "Acme Inc." });
await panel.core.upsertEventType({ name: "invoice.paid", groupName: "Billing" });

const port = Number(process.env.PORT) || 3000;
Bun.serve({
  port,
  fetch: async (request) => {
    const url = new URL(request.url);
    // The mint route lives in YOUR backend (behind YOUR auth in real life):
    // mint a token for the customer whose dashboard is asking, hand it to
    // their browser, and the panel confines it to that application.
    if (url.pathname === "/portal-token" && request.method === "POST") {
      const app = url.searchParams.get("app") ?? "acme";
      const token = await createPortalToken(PORTAL_SECRET, app, { expiresIn: "1h" });
      return Response.json({ token, app, expiresIn: "1h" });
    }
    return panel.fetch(request);
  },
});

console.log(`auth demo "${mode}" on http://localhost:${port}\n`);
if (mode === "delegated") {
  console.log("API keys (X-API-Key header): key-admin | key-support | key-viewer\n");
}
console.log("Try the admin API (who you are decides what you may do):");
console.log(`  curl -s localhost:${port}/api/applications`);
console.log("Mint a customer-scoped portal token (works in every mode):");
console.log(`  curl -s -X POST 'localhost:${port}/portal-token?app=acme'`);
console.log("…then use it as a bearer:");
console.log(
  `  curl -s -H 'authorization: Bearer <token>' localhost:${port}/api/applications/acme/endpoints`,
);
