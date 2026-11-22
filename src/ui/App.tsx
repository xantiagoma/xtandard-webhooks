import React from "react";
import { Router, Switch, Route, useSearchParams } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  canLeave,
  ConfigError,
  CreatableCombobox,
  readConfigGlobal,
  ShellFrame,
  useShellConfig,
  useShellNav,
  useToast,
  type ShellAppProps,
  type ShellTab,
} from "@xtandard/kit/ui";
import type { WebhooksConfig } from "./types.ts";
import { WebhooksApiError } from "./types.ts";
import { getApiToken, getConfig, listApplications, createApplication } from "./api.ts";
import { OverviewView } from "./views/OverviewView.tsx";
import { EndpointsView } from "./views/EndpointsView.tsx";
import { EventTypesView } from "./views/EventTypesView.tsx";
import { MessagesView } from "./views/MessagesView.tsx";
import { DeliveriesView } from "./views/DeliveriesView.tsx";
import { AuditView } from "./views/AuditView.tsx";

interface NavTab extends ShellTab {
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

/**
 * The dashboard, wrapped in a wouter {@link Router}. `locationHook` + `base` make
 * routing pluggable: the bundled SPA uses browser history (clean paths, served by
 * the handler's SPA catch-all), while the embeddable defaults to hash routing so
 * it never touches the host app's router. Pass a custom hook (e.g. memory) to override.
 */
export function App({
  locationHook,
  searchHook,
  base = "",
  logoUrl,
  initialApplicationKey,
  showThemeToggle = true,
  showBrandMark = false,
  forcePortal,
}: ShellAppProps & {
  /** Pre-select an application when the URL doesn't name one (embed hosts). */
  initialApplicationKey?: string;
  /**
   * Show the xtandard mark (`symbol.svg`, served next to the bundle) before the default
   * title. The standalone SPA only: an embed lives in the host's branding.
   */
  showBrandMark?: boolean;
}): React.ReactElement {
  return (
    <Router hook={locationHook ?? useHashLocation} searchHook={searchHook} base={base}>
      <AppShell
        logoUrl={logoUrl}
        initialApplicationKey={initialApplicationKey}
        showThemeToggle={showThemeToggle}
        showBrandMark={showBrandMark}
        forcePortal={forcePortal}
      />
    </Router>
  );
}

function AppShell({
  logoUrl,
  initialApplicationKey,
  showThemeToggle,
  showBrandMark,
  forcePortal,
}: {
  logoUrl?: string;
  initialApplicationKey?: string;
  showThemeToggle: boolean;
  showBrandMark: boolean;
  forcePortal?: boolean;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // Nothing admin-scoped runs until /config has answered: a portal token (or a
  // TokenEmbed) means portal from the first render, and the default route waits
  // for `ready`, so a portal never fires admin requests.
  const shell = useShellConfig<WebhooksConfig>({
    getConfig,
    bootstrap: readConfigGlobal<WebhooksConfig>("__WEBHOOKS_CONFIG__"),
    token: getApiToken(),
    forcePortal,
  });
  const { config, readonly, portal } = shell;
  // Portal mode: one fixed application, derived from the portal principal `portal:<app>`.
  const portalApp = portal ? (config.principal?.id?.replace(/^portal:/, "") ?? "") : null;

  // Branding: explicit props win, then server /config, then defaults.
  const brandTitle = config.title || "@xtandard/webhooks";
  const brandLogoUrl = logoUrl ?? config.logoUrl;

  const applicationsQuery = useQuery({
    queryKey: ["applications"],
    queryFn: listApplications,
    staleTime: 60_000,
    enabled: shell.adminReady,
  });
  const applications = applicationsQuery.data ?? [];

  // Application selection precedence: the URL query wins (a shared link restores
  // context; the switcher writes here), then the embed host's initial prop, then
  // the first application. Portal mode pins the token's application.
  const appKey =
    portalApp ?? (searchParams.get("app") || initialApplicationKey || applications[0]?.key || "");

  // Navigate to a path while preserving the app query. All in-app navigation
  // funnels through the nav guard — a view with unsaved edits can veto the move.
  const go = useShellNav({ stickyParams: ["app"] });

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

  // The bare symbol (SVG, no tile), in each theme's lime (docs/BRAND.md). It only
  // precedes the default title of the standalone admin: a custom title, a logo or
  // the portal stay unbranded.
  const brandMark =
    showBrandMark && !portal && brandTitle === "@xtandard/webhooks" ? (
      <>
        <img src="symbol-light.svg" alt="" aria-hidden="true" className="h-5 w-auto dark:hidden" />
        <img src="symbol.svg" alt="" aria-hidden="true" className="hidden h-5 w-auto dark:block" />
      </>
    ) : null;

  const switcher = portal ? (
    // Portal chrome: no switcher — the token pins the application.
    <span className="font-mono text-[13px] text-muted-foreground">{appKey}</span>
  ) : (
    // Application switcher (type to filter or create)
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
  );

  return (
    <ShellFrame
      title={brandTitle}
      logoUrl={brandLogoUrl}
      brandMark={brandMark}
      switcher={switcher}
      readonly={readonly}
      portal={portal}
      showThemeToggle={showThemeToggle}
      tabs={tabs}
      onNavigate={(path) => go(path)}
      fallback={shell.failed ? <ConfigError /> : null}
    >
      {shell.ready ? (
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
      ) : null}
    </ShellFrame>
  );
}
