import React from "react";
import { Router, Switch, Route, useLocation, useSearchParams, type BaseLocationHook } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import type { WebhooksConfig } from "./types.ts";
import { WebhooksApiError } from "./types.ts";
import { getConfig, listApplications, createApplication } from "./api.ts";
import { useToast } from "./components/Toast.tsx";
import { ThemeToggle } from "./components/ThemeToggle.tsx";
import { OverviewView } from "./views/OverviewView.tsx";
import { EndpointsView } from "./views/EndpointsView.tsx";
import { EventTypesView } from "./views/EventTypesView.tsx";
import { MessagesView } from "./views/MessagesView.tsx";
import { DeliveriesView } from "./views/DeliveriesView.tsx";
import { AuditView } from "./views/AuditView.tsx";
import { cn } from "./lib/utils.ts";
import { canLeave } from "./lib/nav-guard.ts";
import { CreatableCombobox } from "./components/primitives.tsx";

interface NavTab {
  path: string;
  label: string;
  match: (loc: string) => boolean;
  /** Hidden in portal mode. */
  adminOnly?: boolean;
}

// Nav tabs map to route paths. "Overview" is the index ("/") in admin mode;
// portal mode hides it (along with Audit) and lands on Endpoints.
const NAV_TABS: NavTab[] = [
  { path: "/", label: "Overview", match: (l) => l === "/", adminOnly: true },
  { path: "/endpoints", label: "Endpoints", match: (l) => l.startsWith("/endpoints") },
  { path: "/event-types", label: "Event Types", match: (l) => l.startsWith("/event-types") },
  { path: "/messages", label: "Messages", match: (l) => l.startsWith("/messages") },
  { path: "/deliveries", label: "Deliveries", match: (l) => l.startsWith("/deliveries") },
  { path: "/audit", label: "Audit", match: (l) => l.startsWith("/audit"), adminOnly: true },
];

declare global {
  interface Window {
    __WEBHOOKS_CONFIG__?: WebhooksConfig;
  }
}

function getBootstrap(): Partial<WebhooksConfig> {
  return window.__WEBHOOKS_CONFIG__ ?? {};
}

/**
 * The dashboard, wrapped in a wouter {@link Router}. `locationHook` + `base` make
 * routing pluggable: the bundled SPA uses browser history (clean paths, served by
 * the handler's SPA catch-all), while the embeddable defaults to hash routing so
 * it never touches the host app's router. Pass a custom hook (e.g. memory) to override.
 */
export function App({
  locationHook,
  base = "",
  logoUrl,
  initialApplicationKey,
}: {
  locationHook?: BaseLocationHook;
  base?: string;
  /** Override the navbar logo image (otherwise taken from server `/config`). */
  logoUrl?: string;
  /** Pre-select an application when the URL doesn't name one (embed hosts). */
  initialApplicationKey?: string;
}): React.ReactElement {
  return (
    <Router hook={locationHook ?? useHashLocation} base={base}>
      <AppShell logoUrl={logoUrl} initialApplicationKey={initialApplicationKey} />
    </Router>
  );
}

function AppShell({
  logoUrl,
  initialApplicationKey,
}: {
  logoUrl?: string;
  initialApplicationKey?: string;
}) {
  const bootstrap = getBootstrap();
  const toast = useToast();
  const qc = useQueryClient();

  const [location, navigate] = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const configQuery = useQuery({
    queryKey: ["config"],
    queryFn: getConfig,
    staleTime: 60_000,
  });

  const config = configQuery.data ?? (bootstrap as WebhooksConfig);
  const readonly = config?.readonly ?? false;
  // Portal mode: the request is scoped by a portal token — reduced chrome, one
  // fixed application (derived from the portal principal `portal:<app>`).
  const portal = config?.portal ?? false;
  const portalApp = portal ? (config?.principal?.id?.replace(/^portal:/, "") ?? "") : null;

  // Branding: explicit props win, then server /config, then defaults.
  const brandTitle = config?.title || "@xtandard/webhooks";
  const brandLogoUrl = logoUrl ?? config?.logoUrl;

  const applicationsQuery = useQuery({
    queryKey: ["applications"],
    queryFn: listApplications,
    staleTime: 60_000,
    enabled: !portal,
  });
  const applications = applicationsQuery.data ?? [];

  // Application selection precedence: the URL query wins (a shared link restores
  // context; the switcher writes here), then the embed host's initial prop, then
  // the first application. Portal mode pins the token's application.
  const appKey =
    portalApp ?? (searchParams.get("app") || initialApplicationKey || applications[0]?.key || "");

  // Navigate to a path while preserving the app query. All in-app navigation
  // funnels through these helpers, so they consult the nav guard — a view with
  // unsaved edits can veto the move (wouter has no built-in blocker).
  const search = searchParams.toString();
  const go = (path: string) => {
    if (!canLeave()) return;
    navigate(search ? `${path}?${search}` : path);
  };

  const setAppKey = (key: string) => {
    if (!canLeave()) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("app", key);
        return next;
      },
      { replace: false },
    );
  };

  const createAppMutation = useMutation({
    mutationFn: (key: string) => createApplication({ key }),
    onSuccess: (app) => {
      qc.invalidateQueries({ queryKey: ["applications"] });
      setAppKey(app.key);
      toast.add("success", `Application "${app.key}" created`);
    },
    onError: (err: unknown) =>
      toast.add(
        "error",
        err instanceof WebhooksApiError ? err.body.error : "Failed to create application",
      ),
  });

  const tabs = NAV_TABS.filter((t) => !portal || !t.adminOnly);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      {/* ── Top Nav ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
          {/* Brand: a configured logoUrl shows as the logo; otherwise the title
              wordmark. No default icon. */}
          <div className="flex items-center gap-2 shrink-0">
            {brandLogoUrl ? (
              <img
                src={brandLogoUrl}
                alt={brandTitle}
                className="h-7 max-w-[320px] object-contain"
              />
            ) : (
              <span className="text-sm font-semibold tracking-tight">{brandTitle}</span>
            )}
          </div>

          {portal ? (
            // Portal chrome: no switcher — the token pins the application.
            <>
              <span className="text-border select-none">/</span>
              <span className="font-mono text-[13px] text-muted-foreground">{appKey}</span>
            </>
          ) : (
            <>
              <span className="text-border select-none">/</span>
              {/* Application switcher (type to filter or create) */}
              <CreatableCombobox
                value={appKey}
                options={applications.map((a) => a.key)}
                onSelect={setAppKey}
                onCreate={(key) => createAppMutation.mutate(key)}
                disabled={readonly}
                aria-label="Application"
                placeholder="Application"
                createLabel={(q) => `Create application "${q}"`}
                className="w-48"
              />
            </>
          )}

          <div className="ml-auto flex items-center gap-2">
            {readonly && (
              <span className="flex items-center gap-1 rounded-md border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                <Lock className="size-3" />
                Read-only
              </span>
            )}
            {portal && (
              <span className="rounded-md border border-accent/30 bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                Portal
              </span>
            )}
            <ThemeToggle />
          </div>
        </div>

        {/* Nav tabs */}
        <nav
          className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-2 sm:px-4"
          aria-label="Main navigation"
        >
          {tabs.map(({ path, label, match }) => (
            <button
              key={path}
              onClick={() => go(path)}
              className={cn(
                "whitespace-nowrap px-3 py-2.5 text-[13px] font-medium transition-colors",
                match(location)
                  ? "relative text-foreground after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:bg-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      {/* ── Main content (routed) ────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden">
        <Switch>
          <Route path="/endpoints/:id?">
            {(params) => (
              <EndpointsView
                app={appKey}
                readonly={readonly}
                selectedId={params.id}
                onOpen={(id) => go(`/endpoints/${encodeURIComponent(id)}`)}
                onBack={() => go("/endpoints")}
                onOpenDelivery={(id) => go(`/deliveries/${encodeURIComponent(id)}`)}
              />
            )}
          </Route>
          <Route path="/event-types/:name?">
            {(params) => (
              <EventTypesView
                readonly={readonly || portal}
                portal={portal}
                selectedName={params.name}
                onOpen={(name) => go(`/event-types/${encodeURIComponent(name)}`)}
                onBack={() => go("/event-types")}
              />
            )}
          </Route>
          <Route path="/messages/:id?">
            {(params) => (
              <MessagesView
                app={appKey}
                selectedId={params.id}
                onOpen={(id) => go(`/messages/${encodeURIComponent(id)}`)}
                onBack={() => go("/messages")}
                onOpenDelivery={(id) => go(`/deliveries/${encodeURIComponent(id)}`)}
              />
            )}
          </Route>
          <Route path="/deliveries/:id?">
            {(params) => (
              <DeliveriesView
                app={appKey}
                readonly={readonly}
                selectedId={params.id}
                onOpen={(id) => go(`/deliveries/${encodeURIComponent(id)}`)}
                onBack={() => go("/deliveries")}
                onOpenMessage={(id) => go(`/messages/${encodeURIComponent(id)}`)}
                onOpenEndpoint={(id) => go(`/endpoints/${encodeURIComponent(id)}`)}
              />
            )}
          </Route>
          {!portal && (
            <Route path="/audit">
              <AuditView app={appKey} />
            </Route>
          )}
          <Route>
            {portal ? (
              <EndpointsView
                app={appKey}
                readonly={readonly}
                selectedId={undefined}
                onOpen={(id) => go(`/endpoints/${encodeURIComponent(id)}`)}
                onBack={() => go("/endpoints")}
                onOpenDelivery={(id) => go(`/deliveries/${encodeURIComponent(id)}`)}
              />
            ) : (
              <OverviewView
                app={appKey}
                onOpenDelivery={(id) => go(`/deliveries/${encodeURIComponent(id)}`)}
                onCreateEndpoint={() => go("/endpoints")}
              />
            )}
          </Route>
        </Switch>
      </main>
    </div>
  );
}
