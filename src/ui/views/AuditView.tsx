import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listAudit } from "../api.ts";
import type { AuditEntry } from "../types.ts";
import { EmptyCard, LoadingRow, PageHeader } from "../components/webhook-bits.tsx";
import { formatDateTime } from "../lib/format.ts";
import { cn } from "../lib/utils.ts";

interface Props {
  app: string;
}

function formatActor(by: AuditEntry["by"]): string {
  if (!by) return "—";
  return by.name ?? by.email ?? by.id ?? "—";
}

function actionBadge(action: string): string {
  if (action.includes("delete")) return "bg-destructive/10 text-destructive border-destructive/20";
  if (action.includes("disable")) return "bg-warning/10 text-warning border-warning/20";
  if (action.includes("rotate")) return "bg-warning/10 text-warning border-warning/20";
  if (action.includes("create")) return "bg-accent/10 text-accent border-accent/20";
  if (action.includes("retry") || action.includes("recover") || action.includes("enable")) {
    return "bg-success/10 text-success border-success/20";
  }
  return "bg-secondary/60 text-muted-foreground border-border";
}

export function AuditView({ app }: Props) {
  const query = useQuery({
    queryKey: ["audit", app],
    queryFn: () => listAudit(app),
    staleTime: 15_000,
    enabled: app !== "",
  });
  const entries = useMemo(() => query.data ?? [], [query.data]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Audit Log"
        description="A record of every control-plane change for this application. Publishes are data-plane traffic — the message log is their record."
      />

      {query.isLoading && <LoadingRow label="Loading audit log…" />}
      {query.isError && (
        <p className="mt-8 text-center text-[13px] text-destructive">Failed to load audit log</p>
      )}

      {entries.length === 0 && !query.isLoading && !query.isError && (
        <EmptyCard>No audit entries yet.</EmptyCard>
      )}

      {entries.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border">
                  {["Action", "Subject", "By", "At", "Message"].map((h) => (
                    <th
                      key={h}
                      className="whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {entries.map((entry, i) => (
                  <tr key={`${entry.at}-${i}`}>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
                          actionBadge(entry.action),
                        )}
                      >
                        {entry.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-muted-foreground">
                      {entry.subjectId ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground">
                      {formatActor(entry.by)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-[12px] tabular-nums text-muted-foreground">
                      {formatDateTime(entry.at)}
                    </td>
                    <td className="max-w-[240px] px-4 py-3 text-[12px] text-muted-foreground">
                      <span className="block overflow-hidden text-ellipsis whitespace-nowrap">
                        {entry.message ?? "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
