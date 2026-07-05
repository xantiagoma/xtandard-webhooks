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
 * @module
 */

import React from "react";
import type { BaseLocationHook } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { useBrowserLocation } from "wouter/use-browser-location";
import { memoryLocation } from "wouter/memory-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./ui/App.tsx";
import { ToastProvider } from "./ui/components/Toast.tsx";
import { setApiBase, setApiToken, type FetchLike } from "./ui/api.ts";
import { setPortalContainerRef } from "./ui/lib/portal-container.ts";
import { initTheme } from "./ui/theme.ts";
import "./ui/styles.css";

/** Props for {@link WebhooksDashboard}. */
export interface WebhooksDashboardProps {
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
  /** Control theme handling. `"auto"` (default) initializes the system/light/dark switcher. */
  theme?: "auto" | "inherit";
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
  routing?: "hash" | "browser" | "memory" | BaseLocationHook;
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

let fallbackClient: QueryClient | undefined;
function getClient(): QueryClient {
  fallbackClient ??= new QueryClient({
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
  });
  return fallbackClient;
}

/** The full webhooks admin dashboard as an embeddable React component. */
export function WebhooksDashboard({
  apiBaseUrl = "",
  credentials,
  fetch: fetchImpl,
  queryClient,
  theme = "auto",
  className,
  routing = "hash",
  routerBase = "",
  logoUrl,
  initialApplicationKey,
}: WebhooksDashboardProps): React.ReactElement {
  // Set the API base synchronously so child queries (run on mount) use it.
  setApiBase(apiBaseUrl, { credentials, fetch: fetchImpl });

  React.useEffect(() => {
    if (theme === "auto") initTheme();
  }, [theme]);

  const client = queryClient ?? getClient();

  // Point Base UI portals (Select/Combobox popups, Dialogs) at the scoped
  // wrapper so they render inside `.xtandard-webhooks` — the embed stylesheet
  // is scoped, so anything portaled to document.body would be unstyled.
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  setPortalContainerRef(wrapperRef);

  // Resolve the routing strategy to a wouter location hook (+ base). The memory
  // hook is created once so its in-memory history survives re-renders.
  const memoryHook = React.useMemo(() => memoryLocation().hook, []);
  const { hook, base } = React.useMemo(() => {
    if (typeof routing === "function") return { hook: routing, base: routerBase };
    if (routing === "browser") return { hook: useBrowserLocation, base: routerBase };
    if (routing === "memory") return { hook: memoryHook, base: "" };
    return { hook: useHashLocation, base: "" };
  }, [routing, routerBase, memoryHook]);

  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <div
          ref={wrapperRef}
          className={className ? `xtandard-webhooks ${className}` : "xtandard-webhooks"}
        >
          <App
            locationHook={hook}
            base={base}
            logoUrl={logoUrl}
            initialApplicationKey={initialApplicationKey}
          />
        </div>
      </ToastProvider>
    </QueryClientProvider>
  );
}

/**
 * The customer-scoped consumer portal as an embeddable React component. Renders
 * the same shell as {@link WebhooksDashboard} with the portal token attached as
 * a Bearer credential; the server scopes every request to the token's
 * application and `/config` flips the shell into the reduced portal chrome.
 */
export function WebhooksPortal({ token, ...rest }: WebhooksPortalProps): React.ReactElement {
  // Attach the token synchronously so child queries (run on mount) send it; the
  // effect keeps it current when the host swaps tokens (e.g. re-mint on expiry).
  // The API client is module-level state, so this assumes one embed per page —
  // same trade-off setApiBase makes.
  setApiToken(token);
  React.useEffect(() => {
    setApiToken(token);
  }, [token]);

  return <WebhooksDashboard {...rest} />;
}

export { setApiBase, setApiToken, type FetchLike } from "./ui/api.ts";
export { setThemePref, getThemePref, type ThemePref } from "./ui/theme.ts";
export default WebhooksDashboard;
