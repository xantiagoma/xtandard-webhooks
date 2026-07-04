# ADR 0006 — Portal Tokens: Signed HMAC Tokens, Not Sessions

**Status:** Accepted

---

## Context

The consumer portal is the flagship embed: your customer manages _their own_ endpoints and inspects _their own_ deliveries inside your product's UI. That requires per-application scoped access for principals your app authenticates — but this package must not become an identity provider, and must not require session storage, cookies, or a database table of tokens.

Alternatives:

- **Sessions** — server-side state, cookie plumbing across the embed boundary, CSRF surface.
- **Ask the host to proxy every portal call** — works, but every host rebuilds the same scoping logic; the embed stops being drop-in.
- **Signed, expiring, application-scoped bearer tokens** — the host mints a token server-side (it already knows who its user is) and hands it to its frontend; the panel verifies statelessly.

---

## Decision

`createPortalToken(secret, applicationKey, { expiresIn })` produces `whpt_` + base64url(`{ app, exp }`) + `.` + base64url(HMAC-SHA256(secret, payload)) — verified statelessly by the panel configured with `portal: { secret }`. Default expiry 7 days.

Authorization for portal principals is **force-scoped and closed**: only the token's application, only the actions in `portal.allow` (default: endpoint management, message/delivery reading, delivery retry, event-type reading). The host's own authorization provider is deliberately _not_ consulted for portal principals — portal scoping wins, defense in depth.

The portal is not a second API or a second SPA: it is the same routes under scoped auth, and the same UI bundle rendering reduced chrome when `/config` says `portal: true`.

---

## Consequences

- Hosts integrate with two lines: mint a token in a route handler, pass it to `<WebhooksPortal>`.
- Tokens are bearer credentials: they must travel over HTTPS and should be short-lived; revocation before expiry means rotating the portal secret (documented in `docs/PORTAL.md`).
- No session state anywhere in the package.
