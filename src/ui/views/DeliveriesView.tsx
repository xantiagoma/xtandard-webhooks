import React, { useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, Copy, RotateCcw, Terminal } from "lucide-react";
import type { DeliveryAttempt, DeliveryStatus, SignedRequest } from "../types.ts";
import { WebhooksApiError } from "../types.ts";
import {
  getDelivery,
  getDeliveryRequest,
  listDeliveries,
  listEndpoints,
  retryDelivery,
} from "../api.ts";
import { useToast } from "../components/Toast.tsx";
import { JsonCodeEditor } from "../components/JsonCodeEditor.tsx";
import { Button, Badge } from "../components/ui-bits.tsx";
import { Dropdown } from "../components/primitives.tsx";
import {
  DeliveryStatusBadge,
  EmptyCard,
  LoadingRow,
  Mono,
  NoApplication,
  PageHeader,
  SectionCard,
} from "../components/webhook-bits.tsx";
import { formatDateTime, formatDurationMs, relativeTime } from "../lib/format.ts";
import { cn } from "../lib/utils.ts";

const PAGE_SIZE = 50;

interface Props {
  app: string;
  readonly: boolean;
  selectedId?: string;
  onOpen: (id: string) => void;
  onBack: () => void;
  onOpenMessage: (id: string) => void;
  onOpenEndpoint: (id: string) => void;
}

/** Filter tabs; "Dead-letter" is the `failed` terminal state. */
const STATUS_TABS: { label: string; status: DeliveryStatus | "" }[] = [
  { label: "All", status: "" },
  { label: "Pending", status: "pending" },
  { label: "Succeeded", status: "succeeded" },
  { label: "Dead-letter", status: "failed" },
];

const TRIGGER_TONE: Record<DeliveryAttempt["trigger"], string> = {
  schedule: "border-border bg-secondary/60 text-muted-foreground",
  manual: "border-accent/30 bg-accent/10 text-accent",
  test: "border-chart-2/30 bg-chart-2/10 text-chart-2",
};

function AttemptRow({ attempt }: { attempt: DeliveryAttempt }) {
  return (
    <li className="relative pl-8">
      {/* Timeline dot */}
      <span
        className={cn(
          "absolute left-2 top-1.5 size-2.5 rounded-full border-2 border-card",
          attempt.ok ? "bg-success" : "bg-destructive",
        )}
        aria-hidden
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold text-foreground">
          Attempt #{attempt.attemptNumber}
        </span>
        <Badge className={TRIGGER_TONE[attempt.trigger]}>{attempt.trigger}</Badge>
        {attempt.httpStatus !== undefined ? (
          <span
            className={cn(
              "font-mono text-[12px] font-medium",
              attempt.ok ? "text-success" : "text-destructive",
            )}
          >
            HTTP {attempt.httpStatus}
          </span>
        ) : (
          <span className="font-mono text-[12px] font-medium text-destructive">
            {attempt.error ?? "network error"}
          </span>
        )}
        <span className="text-xs tabular-nums text-muted-foreground">
          {formatDurationMs(attempt.durationMs)}
        </span>
        <span
          className="ml-auto whitespace-nowrap text-xs tabular-nums text-muted-foreground"
          title={formatDateTime(attempt.at)}
        >
          {formatDateTime(attempt.at)}
        </span>
      </div>
      {attempt.responseBody !== undefined && attempt.responseBody !== "" && (
        <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-secondary/30 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {attempt.responseBody}
        </pre>
      )}
      {attempt.error !== undefined && attempt.httpStatus !== undefined && (
        <p className="mt-1 font-mono text-[11px] text-destructive">{attempt.error}</p>
      )}
    </li>
  );
}

/** The Standard Webhooks signing headers, called out from the transport noise. */
const SIGNING_HEADERS = new Set(["webhook-id", "webhook-timestamp", "webhook-signature"]);

/** Shell-quote a value for a single-quoted curl argument. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Assemble a copy-pasteable `curl` command from the signed request. */
function toCurl(reqData: SignedRequest): string {
  const parts = [`curl -X ${reqData.method} ${shellQuote(reqData.url)}`];
  for (const [key, value] of Object.entries(reqData.headers)) {
    parts.push(`  -H ${shellQuote(`${key}: ${value}`)}`);
  }
  if (reqData.body) parts.push(`  -d ${shellQuote(reqData.body)}`);
  return parts.join(" \\\n");
}

/** Pretty-print the body if it parses as JSON; otherwise pass it through. */
function prettyBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function HeaderRow({ name, value, signing }: { name: string; value: string; signing: boolean }) {
  return (
    <div
      className={cn(
        "flex gap-3 px-3 py-1.5",
        signing && "bg-accent/[0.06] border-l-2 border-accent",
      )}
    >
      <span
        className={cn(
          "w-44 shrink-0 break-all font-mono text-[12px]",
          signing ? "font-semibold text-accent" : "text-foreground",
        )}
      >
        {name}
      </span>
      <span className="min-w-0 flex-1 break-all font-mono text-[12px] text-muted-foreground">
        {value}
      </span>
    </div>
  );
}

/**
 * The in-panel webhook inspector: the exact signed request a delivery sends.
 * Lazy-loaded — the query is enabled only once the section is opened.
 */
function RequestInspector({ app, deliveryId }: { app: string; deliveryId: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);

  const query = useQuery({
    queryKey: ["delivery-request", app, deliveryId],
    queryFn: () => getDeliveryRequest(app, deliveryId),
    enabled: open,
  });

  const copyCurl = async () => {
    if (!query.data) return;
    try {
      await navigator.clipboard.writeText(toCurl(query.data));
      toast.add(
        "success",
        "Copied curl command",
        "Paste it into a terminal to replay the request.",
      );
    } catch {
      toast.add("error", "Copy failed", "Clipboard access was denied by the browser.");
    }
  };

  const data = query.data;
  // Stable header ordering: signing headers first, then the rest as sent.
  const headerEntries = data
    ? Object.entries(data.headers).sort((a, b) => {
        const as = SIGNING_HEADERS.has(a[0].toLowerCase()) ? 0 : 1;
        const bs = SIGNING_HEADERS.has(b[0].toLowerCase()) ? 0 : 1;
        return as - bs;
      })
    : [];

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-[13px] font-semibold text-foreground">Request</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            The signature and webhook-timestamp are computed live; each attempt re-signs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {open && data && (
            <Button
              size="sm"
              variant="secondary"
              icon={<Copy className="size-3.5" />}
              onClick={copyCurl}
              aria-label="Copy request as a curl command"
            >
              Copy as curl
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            icon={<Terminal className="size-3.5" />}
            aria-expanded={open}
            aria-controls="delivery-request-panel"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Hide request" : "Show request"}
          </Button>
        </div>
      </div>

      {open && (
        <div id="delivery-request-panel" className="px-4 py-4">
          {query.isLoading ? (
            <LoadingRow label="Building the signed request…" />
          ) : query.isError || !data ? (
            <p className="text-[13px] text-muted-foreground">
              Could not build the request — the delivery or its endpoint may have been deleted.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="overflow-x-auto rounded-md border border-border bg-secondary/30 px-3 py-2">
                <code className="whitespace-nowrap font-mono text-[12px] text-foreground">
                  <span className="font-semibold text-accent">{data.method}</span> {data.url}
                </code>
              </div>

              <div>
                <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">Headers</h3>
                <div className="divide-y divide-border overflow-hidden rounded-md border border-border">
                  {headerEntries.map(([name, value]) => (
                    <HeaderRow
                      key={name}
                      name={name}
                      value={value}
                      signing={SIGNING_HEADERS.has(name.toLowerCase())}
                    />
                  ))}
                </div>
              </div>

              <div>
                <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">Body</h3>
                <JsonCodeEditor value={prettyBody(data.body)} onChange={() => {}} readOnly />
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function DeliveryDetailView({
  app,
  id,
  readonly,
  onBack,
  onOpenMessage,
  onOpenEndpoint,
}: {
  app: string;
  id: string;
  readonly: boolean;
  onBack: () => void;
  onOpenMessage: (id: string) => void;
  onOpenEndpoint: (id: string) => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["deliveries", app, { id }],
    queryFn: () => getDelivery(app, id),
    refetchInterval: (q) => {
      // A retried/pending delivery is actively moving — poll briefly.
      const status = q.state.data?.status;
      return status === "pending" || status === "delivering" ? 1500 : false;
    },
  });

  const retryMutation = useMutation({
    mutationFn: () => retryDelivery(app, id),
    onSuccess: () => {
      toast.add("success", "Delivery re-queued", "It is due for immediate retry.");
      qc.invalidateQueries({ queryKey: ["deliveries", app] });
    },
    onError: (err: unknown) =>
      toast.add(
        "error",
        err instanceof WebhooksApiError ? err.body.error : "Failed to retry delivery",
      ),
  });

  if (query.isLoading) return <LoadingRow label="Loading delivery…" />;
  if (query.isError || !query.data) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <EmptyCard>Delivery not found.</EmptyCard>
      </div>
    );
  }
  const delivery = query.data;
  const attempts = [...delivery.attempts].sort((a, b) => b.attemptNumber - a.attemptNumber);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <button
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Deliveries
      </button>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-xl font-semibold tracking-tight">{delivery.id}</h1>
        <DeliveryStatusBadge status={delivery.status} />
        {!readonly && delivery.status === "failed" && (
          <Button
            variant="primary"
            size="sm"
            icon={<RotateCcw className="size-3.5" />}
            loading={retryMutation.isPending}
            onClick={() => retryMutation.mutate()}
          >
            Retry
          </Button>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2">
        <div className="flex items-center gap-2">
          <dt className="w-28 shrink-0 text-xs font-medium text-muted-foreground">Message</dt>
          <dd>
            <button
              onClick={() => onOpenMessage(delivery.messageId)}
              className="font-mono text-[12px] text-accent hover:underline"
            >
              {delivery.messageId}
            </button>
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="w-28 shrink-0 text-xs font-medium text-muted-foreground">Endpoint</dt>
          <dd>
            <button
              onClick={() => onOpenEndpoint(delivery.endpointId)}
              className="font-mono text-[12px] text-accent hover:underline"
            >
              {delivery.endpointId}
            </button>
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="w-28 shrink-0 text-xs font-medium text-muted-foreground">Created</dt>
          <dd className="tabular-nums text-muted-foreground">
            {formatDateTime(delivery.createdAt)}
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="w-28 shrink-0 text-xs font-medium text-muted-foreground">Next attempt</dt>
          <dd className="tabular-nums text-muted-foreground">
            {delivery.nextAttemptAt ? formatDateTime(delivery.nextAttemptAt) : "—"}
          </dd>
        </div>
      </dl>

      <div className="mt-6">
        <SectionCard
          title={`Attempt timeline (${attempts.length})`}
          description="Newest first. Response bodies are truncated server-side."
        >
          {attempts.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              No attempts yet — the dispatcher picks it up when it is due.
            </p>
          ) : (
            <ul className="relative flex flex-col gap-4 before:absolute before:bottom-1 before:left-[13px] before:top-2 before:w-px before:bg-border">
              {attempts.map((attempt) => (
                <AttemptRow key={attempt.id} attempt={attempt} />
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <div className="mt-6">
        <RequestInspector app={app} deliveryId={id} />
      </div>
    </div>
  );
}

export function DeliveriesView({
  app,
  readonly,
  selectedId,
  onOpen,
  onBack,
  onOpenMessage,
  onOpenEndpoint,
}: Props) {
  const [status, setStatus] = useState<DeliveryStatus | "">("");
  const [endpointId, setEndpointId] = useState("");

  const endpointsQuery = useQuery({
    queryKey: ["endpoints", app],
    queryFn: () => listEndpoints(app),
    staleTime: 30_000,
    enabled: app !== "",
  });
  const endpoints = endpointsQuery.data ?? [];
  const endpointUrl = (id: string) => endpoints.find((e) => e.id === id)?.url ?? id;

  const query = useInfiniteQuery({
    queryKey: ["deliveries", app, { status, endpointId }],
    queryFn: ({ pageParam }) =>
      listDeliveries(app, {
        limit: PAGE_SIZE,
        ...(status ? { status } : {}),
        ...(endpointId ? { endpoint: endpointId } : {}),
        ...(pageParam ? { before: pageParam } : {}),
      }),
    initialPageParam: "",
    getNextPageParam: (lastPage) =>
      lastPage.length === PAGE_SIZE ? lastPage[lastPage.length - 1]?.id : undefined,
    enabled: app !== "" && !selectedId,
    // The operational log: keep it live while it's on screen.
    refetchInterval: 2_000,
  });

  if (!app) return <NoApplication />;

  if (selectedId) {
    return (
      <DeliveryDetailView
        app={app}
        id={selectedId}
        readonly={readonly}
        onBack={onBack}
        onOpenMessage={onOpenMessage}
        onOpenEndpoint={onOpenEndpoint}
      />
    );
  }

  const deliveries = query.data?.pages.flat() ?? [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Deliveries"
        description="One message to one endpoint, driven through the retry schedule to a terminal state."
      />

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="inline-flex h-9 items-center rounded-md border border-input bg-secondary/40 p-0.5 text-[13px]">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.label}
              type="button"
              onClick={() => setStatus(tab.status)}
              className={cn(
                "h-8 rounded-[5px] px-3 font-medium transition-colors",
                status === tab.status
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <Dropdown
          aria-label="Filter by endpoint"
          value={endpointId}
          onValueChange={setEndpointId}
          options={[
            { value: "", label: "All endpoints" },
            ...endpoints.map((e) => ({ value: e.id, label: e.url })),
          ]}
          className="w-72"
        />
      </div>

      {query.isLoading ? (
        <LoadingRow label="Loading deliveries…" />
      ) : query.isError ? (
        <EmptyCard>Failed to load deliveries.</EmptyCard>
      ) : deliveries.length === 0 ? (
        <EmptyCard>No deliveries match the current filters.</EmptyCard>
      ) : (
        <>
          <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
            <ul className="divide-y divide-border">
              {deliveries.map((delivery) => (
                <li key={delivery.id}>
                  <button
                    onClick={() => onOpen(delivery.id)}
                    className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/30"
                  >
                    <DeliveryStatusBadge status={delivery.status} />
                    <div className="min-w-0 flex-1">
                      <Mono className="block truncate">{delivery.id}</Mono>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {endpointUrl(delivery.endpointId)} · {delivery.attemptCount} attempt
                        {delivery.attemptCount === 1 ? "" : "s"}
                      </p>
                    </div>
                    <span
                      className="whitespace-nowrap text-xs tabular-nums text-muted-foreground"
                      title={formatDateTime(delivery.updatedAt)}
                    >
                      {relativeTime(delivery.updatedAt)}
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {query.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="secondary"
                loading={query.isFetchingNextPage}
                onClick={() => query.fetchNextPage()}
              >
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
