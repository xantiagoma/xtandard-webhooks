/**
 * `@xtandard/webhooks/react` — embed the dashboard as a React component in your
 * own app (advanced mode). Most users mount the bundled SPA via a framework
 * adapter and never touch React; this is for teams that want the panel inside an
 * existing React shell.
 *
 * Two components share the same SPA internals:
 *
 * ```tsx
 * import { WebhooksDashboard, WebhooksPortal } from "@xtandard/webhooks/react";
 * import "@xtandard/webhooks/react/styles.css";
 *
 * // Full admin — point it at wherever the panel API is mounted:
 * <WebhooksDashboard apiBaseUrl="/webhooks" />
 *
 * // Customer-scoped portal — pass a portal token minted server-side:
 * <WebhooksPortal apiBaseUrl="/webhooks" token={portalToken} />
 * ```
 *
 * `react` and `react-dom` are peer dependencies in this mode. The components are
 * self-contained otherwise (TanStack Query and styles are bundled).
 *
 * @module react
 */

import type { QueryClient } from "@tanstack/react-query";
import { createEmbed, type EmbedBaseProps, type EmbedRouting } from "@xtandard/kit/ui/embed";
import type { FetchLike } from "@xtandard/kit/ui";
import { App } from "./ui/App.tsx";
import * as api from "./ui/api.ts";
import { themeStore } from "./ui/theme.ts";
import "./ui/styles.css";

/** Theme modes for the embedded components (see {@link WebhooksDashboardProps.theme}). */
export type EmbedTheme = "auto" | "inherit" | "light" | "dark";

/** Props for {@link WebhooksDashboard}. */
export interface WebhooksDashboardProps extends EmbedBaseProps {
  /**
   * Base URL where the panel API + `/config` are mounted (e.g. `"/webhooks"` or
   * `"https://admin.example.com/webhooks"`). Defaults to `""` (same origin, relative).
   */
  apiBaseUrl?: string;
  /**
   * `credentials` mode for API requests. Defaults to `"same-origin"`. For a
   * **cross-origin** embed (panel served from a different origin than this app)
   * with cookie-based auth, set `"include"` — and enable `cors` on the panel
   * server so it returns `Access-Control-Allow-Credentials`.
   */
  credentials?: RequestCredentials;
  /**
   * Custom `fetch` for API requests — inject a bearer token / extra headers, or
   * instrument calls. Defaults to the global `fetch`.
   */
  fetch?: FetchLike;
  /** Bring your own QueryClient; one is created if omitted. */
  queryClient?: QueryClient;
  /**
   * Theme handling. The embed never writes to the host document — it resolves a
   * theme and applies it to its own wrapper (`data-theme`), so surfaces, text,
   * borders and code views always come from one theme.
   * - `"auto"` (default) — the panel's own system/light/dark switcher (preference
   *   persisted in localStorage).
   * - `"inherit"` — follow the host page, live: a `dark`/`light` class or
   *   `data-theme` attribute on `<html>` (then `<body>`), falling back to the OS
   *   `prefers-color-scheme`. The switcher is hidden; the host owns the theme.
   * - `"light"` / `"dark"` — force one theme (switcher hidden). Useful when the
   *   host tracks its theme some other way: pass its resolved value.
   */
  theme?: EmbedTheme;
  /** Extra className on the dashboard root wrapper. */
  className?: string;
  /**
   * How the dashboard routes between views/records.
   * - `"hash"` (default) — routes in `location.hash`; never touches the host app's
   *   router or pathname. Safest when mounted inside another app.
   * - `"browser"` — real history paths (clean URLs). Requires the host to serve the
   *   panel's `index.html` as a catch-all under `routerBase`, else refresh 404s.
   * - `"memory"` — in-memory only; no URL coupling at all.
   * - a custom wouter location hook for full control.
   */
  routing?: EmbedRouting;
  /** Base path the panel is mounted at, used by `routing: "browser"` (e.g. `"/admin/webhooks"`). */
  routerBase?: string;
  /** Navbar logo image URL (replaces the title wordmark). Overrides server `/config`. */
  logoUrl?: string;
  /**
   * Pre-select an application on first render, overriding the default (first
   * application) — e.g. an admin panel embedding one dashboard per tenant. The
   * URL still wins when it names one (`?app=`), so deep links and the in-app
   * switcher behave normally afterwards.
   */
  initialApplicationKey?: string;
}

/** Props for {@link WebhooksPortal}. */
export interface WebhooksPortalProps extends Omit<WebhooksDashboardProps, "initialApplicationKey"> {
  /**
   * Portal token (`whpt_…`) minted server-side via `createPortalToken()`. Sent as
   * an `Authorization: Bearer` credential on every API request; `/config` then
   * reports `portal: true` and the shell renders the reduced, application-pinned
   * portal chrome.
   */
  token: string;
}

/**
 * The shared embed plumbing (`@xtandard/kit/ui/embed`): one theme per embed on
 * the `.xtandard-webhooks` wrapper, toasts and Base UI portals inside it, the
 * memory router keeping its query string, and the portal token attached
 * synchronously (queries refetch when it changes).
 */
const embed = createEmbed<{ initialApplicationKey?: string }>({
  App,
  scopeClass: "xtandard-webhooks",
  api,
  themeKey: themeStore,
  tokenRouting: "hash", // the portal routes in the hash too, as it always has
  displayNames: { dashboard: "WebhooksDashboard", token: "WebhooksPortal" },
});

/** The full webhooks admin dashboard as an embeddable React component. */
export const WebhooksDashboard: React.FC<WebhooksDashboardProps> = embed.Dashboard;

/**
 * The customer-scoped consumer portal as an embeddable React component. Renders
 * the same shell as {@link WebhooksDashboard} with the portal token attached as
 * a Bearer credential; the server scopes every request to the token's
 * application and the shell renders the reduced portal chrome.
 */
export const WebhooksPortal: React.FC<WebhooksPortalProps> = embed.TokenEmbed;

export { setApiBase, setApiToken } from "./ui/api.ts";
export type { FetchLike };
export {
  setThemePref,
  getThemePref,
  detectHostTheme,
  type ThemePref,
  type ResolvedTheme,
} from "./ui/theme.ts";
export default WebhooksDashboard;
