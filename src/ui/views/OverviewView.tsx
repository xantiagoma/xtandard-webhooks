import React from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { listDeliveries, listEndpoints } from "../api.ts";
import { formatDateTime, relativeTime, successRate, withinWindow } from "../lib/format.ts";
import { cn } from "../lib/utils.ts";
import {
  DeliveryStatusBadge,
  EmptyCard,
  LoadingRow,
  Mono,
  NoApplication,
  PageHeader,
} from "../components/webhook-bits.tsx";

const DAY_MS = 86_400_000;

interface Props {
  app: string;
  onOpenDelivery: (id: string) => void;
  onCreateEndpoint: () => void;
}

function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={cn("mt-1.5 text-2xl font-semibold tabular-nums tracking-tight", tone)}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * Per-application dashboard: 24h delivery stats computed client-side from the
 * most recent deliveries page (honest about its window — no fake charts).
 */
export function OverviewView({ app, onOpenDelivery, onCreateEndpoint: _onCreateEndpoint }: Props) {
  const deliveriesQuery = useQuery({
    queryKey: ["deliveries", app, { view: "overview" }],
    queryFn: () => listDeliveries(app, { limit: 200 }),
    staleTime: 10_000,
    enabled: app !== "",
  });
  const endpointsQuery = useQuery({
    queryKey: ["endpoints", app],
    queryFn: () => listEndpoints(app),
    staleTime: 30_000,
    enabled: app !== "",
  });

  if (!app) return <NoApplication />;

  const deliveries = deliveriesQuery.data ?? [];
  const endpoints = endpointsQuery.data ?? [];
  const endpointUrl = (id: string) => endpoints.find((e) => e.id === id)?.url ?? id;

  const now = Date.now();
  const recent = deliveries.filter((d) => withinWindow(d.updatedAt, DAY_MS, now));
  const attempts24h = recent.reduce((sum, d) => sum + d.attemptCount, 0);
  const succeeded24h = recent.filter((d) => d.status === "succeeded").length;
  const failed24h = recent.filter((d) => d.status === "failed").length;
  const rate = successRate(succeeded24h, failed24h);
  const deadLetter = deliveries.filter((d) => d.status === "failed");
  const recentFailures = deadLetter.slice(0, 8);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Overview"
        description={
          <>
            Delivery health for <span className="font-mono">{app}</span> over the last 24 hours.
          </>
        }
      />

      {deliveriesQuery.isLoading ? (
        <LoadingRow label="Loading deliveries…" />
      ) : deliveriesQuery.isError ? (
        <EmptyCard>Failed to load deliveries.</EmptyCard>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard
              label="Attempts (24h)"
              value={String(attempts24h)}
              hint={`${recent.length} deliver${recent.length === 1 ? "y" : "ies"} touched`}
              tone="text-chart-1"
            />
            <StatCard
              label="Success rate (24h)"
              value={rate === null ? "—" : `${rate}%`}
              hint={
                rate === null
                  ? "No terminal deliveries yet"
                  : `${succeeded24h} succeeded · ${failed24h} dead-lettered`
              }
              tone={rate !== null && rate < 90 ? "text-warning" : "text-success"}
            />
            <StatCard
              label="Dead-letter"
              value={String(deadLetter.length)}
              hint="Exhausted deliveries awaiting retry"
              tone={deadLetter.length > 0 ? "text-destructive" : undefined}
            />
          </div>

          <div className="mt-8">
            <h2 className="text-sm font-semibold text-foreground">Recent failures</h2>
            {recentFailures.length === 0 ? (
              <EmptyCard>No dead-lettered deliveries. Everything is flowing.</EmptyCard>
            ) : (
              <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
                <ul className="divide-y divide-border">
                  {recentFailures.map((d) => (
                    <li key={d.id}>
                      <button
                        onClick={() => onOpenDelivery(d.id)}
                        className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/30"
                      >
                        <DeliveryStatusBadge status={d.status} />
                        <div className="min-w-0 flex-1">
                          <Mono className="block truncate">{d.id}</Mono>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {endpointUrl(d.endpointId)} · {d.attemptCount} attempt
                            {d.attemptCount === 1 ? "" : "s"}
                          </p>
                        </div>
                        <span
                          className="whitespace-nowrap text-xs tabular-nums text-muted-foreground"
                          title={formatDateTime(d.updatedAt)}
                        >
                          {relativeTime(d.updatedAt)}
                        </span>
                        <ChevronRight className="size-4 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
