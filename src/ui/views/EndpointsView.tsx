import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, Plus, RefreshCw, Send, Trash2 } from "lucide-react";
import type { EndpointSecret, EndpointSummary } from "../types.ts";
import { WebhooksApiError } from "../types.ts";
import {
  createEndpoint,
  deleteEndpoint,
  disableEndpoint,
  enableEndpoint,
  getEndpointSecrets,
  listDeliveries,
  listEndpoints,
  listEventTypes,
  recoverEndpoint,
  rotateEndpointSecret,
  sendExample,
  updateEndpoint,
} from "../api.ts";
import { useToast } from "../components/Toast.tsx";
import { Button, Badge } from "../components/ui-bits.tsx";
import { Dropdown, TextInput } from "../components/primitives.tsx";
import {
  ConfirmDialog,
  DeliveryStatusBadge,
  EmptyCard,
  LoadingRow,
  ModalDialog,
  Mono,
  NoApplication,
  PageHeader,
  SectionCard,
} from "../components/webhook-bits.tsx";
import { formatDateTime, relativeTime } from "../lib/format.ts";
import { cn } from "../lib/utils.ts";
import { clearNavBlocker, setNavBlocker } from "../lib/nav-guard.ts";

interface Props {
  app: string;
  readonly: boolean;
  selectedId?: string;
  onOpen: (id: string) => void;
  onBack: () => void;
  onOpenDelivery: (id: string) => void;
}

const errMessage = (err: unknown, fallback: string): string =>
  err instanceof WebhooksApiError ? err.body.error : fallback;

/* ─── Secret display ────────────────────────────────────────────────────────── */

function SecretBlock({ secret, testId }: { secret: string; testId?: string }) {
  return (
    <code
      data-testid={testId}
      className="block w-full select-all break-all rounded-md border border-border bg-secondary/40 px-3 py-2 font-mono text-[12px] text-foreground"
    >
      {secret}
    </code>
  );
}

/* ─── Headers editor ────────────────────────────────────────────────────────── */

type HeaderRow = { key: string; value: string };

function HeadersEditor({
  rows,
  onChange,
  readonly,
}: {
  rows: HeaderRow[];
  onChange: (rows: HeaderRow[]) => void;
  readonly: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      {rows.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No custom headers. They are merged into every delivery request.
        </p>
      )}
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <TextInput
            className="font-mono"
            placeholder="X-Header-Name"
            aria-label={`Header ${i + 1} name`}
            value={row.key}
            disabled={readonly}
            onChange={(e) =>
              onChange(rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))
            }
          />
          <TextInput
            className="font-mono"
            placeholder="value"
            aria-label={`Header ${i + 1} value`}
            value={row.value}
            disabled={readonly}
            onChange={(e) =>
              onChange(rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))
            }
          />
          {!readonly && (
            <button
              onClick={() => onChange(rows.filter((_, j) => j !== i))}
              className="shrink-0 rounded-md p-1.5 text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
              aria-label={`Remove header ${row.key || i + 1}`}
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
      ))}
      {!readonly && (
        <div>
          <Button
            size="sm"
            variant="secondary"
            icon={<Plus className="size-3.5" />}
            onClick={() => onChange([...rows, { key: "", value: "" }])}
          >
            Add header
          </Button>
        </div>
      )}
    </div>
  );
}

/* ─── Detail ────────────────────────────────────────────────────────────────── */

interface Draft {
  url: string;
  description: string;
  eventTypes: string[];
  headers: HeaderRow[];
}

const toDraft = (endpoint: EndpointSummary): Draft => ({
  url: endpoint.url,
  description: endpoint.description ?? "",
  eventTypes: [...(endpoint.eventTypes ?? [])],
  headers: Object.entries(endpoint.headers ?? {}).map(([key, value]) => ({ key, value })),
});

const draftEquals = (a: Draft, b: Draft): boolean =>
  a.url === b.url &&
  a.description === b.description &&
  JSON.stringify([...a.eventTypes].sort()) === JSON.stringify([...b.eventTypes].sort()) &&
  JSON.stringify(a.headers) === JSON.stringify(b.headers);

function EndpointDetail({
  app,
  endpoint,
  readonly,
  onBack,
  onOpenDelivery,
}: {
  app: string;
  endpoint: EndpointSummary;
  readonly: boolean;
  onBack: () => void;
  onOpenDelivery: (id: string) => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["endpoints", app] });

  const [draft, setDraft] = useState<Draft>(() => toDraft(endpoint));
  const saved = useMemo(() => toDraft(endpoint), [endpoint]);
  const dirty = !draftEquals(draft, saved);

  // Reset the draft when another endpoint is opened.
  useEffect(() => {
    setDraft(toDraft(endpoint));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint.id]);

  // Unsaved edits veto in-app navigation (see lib/nav-guard.ts).
  useEffect(() => {
    const blocker = () => !dirty || window.confirm("Discard unsaved endpoint changes?");
    setNavBlocker(blocker);
    return () => clearNavBlocker(blocker);
  }, [dirty]);

  const catalogQuery = useQuery({ queryKey: ["event-types"], queryFn: listEventTypes });
  const catalog = catalogQuery.data ?? [];

  const deliveriesQuery = useQuery({
    queryKey: ["deliveries", app, { endpoint: endpoint.id }],
    queryFn: () => listDeliveries(app, { endpoint: endpoint.id, limit: 20 }),
    staleTime: 5_000,
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      updateEndpoint(app, endpoint.id, {
        url: draft.url,
        description: draft.description || undefined,
        eventTypes: draft.eventTypes,
        headers: Object.fromEntries(
          draft.headers.filter((h) => h.key.trim() !== "").map((h) => [h.key.trim(), h.value]),
        ),
      }),
    onSuccess: () => {
      toast.add("success", "Endpoint saved");
      invalidate();
    },
    onError: (err: unknown) => toast.add("error", errMessage(err, "Failed to save endpoint")),
  });

  // Secrets: revealed on demand (gated server-side by endpoint:read-secret).
  const [secrets, setSecrets] = useState<EndpointSecret[] | null>(null);
  const revealMutation = useMutation({
    mutationFn: () => getEndpointSecrets(app, endpoint.id),
    onSuccess: setSecrets,
    onError: (err: unknown) => toast.add("error", errMessage(err, "Failed to reveal the secret")),
  });

  const [rotateOpen, setRotateOpen] = useState(false);
  const rotateMutation = useMutation({
    mutationFn: () => rotateEndpointSecret(app, endpoint.id),
    onSuccess: (rotated) => {
      setSecrets(rotated.secrets);
      setRotateOpen(false);
      toast.add(
        "success",
        "Secret rotated",
        "The previous secret keeps verifying until grace expiry.",
      );
      invalidate();
    },
    onError: (err: unknown) => toast.add("error", errMessage(err, "Failed to rotate the secret")),
  });

  const toggleMutation = useMutation({
    mutationFn: () =>
      endpoint.disabled ? enableEndpoint(app, endpoint.id) : disableEndpoint(app, endpoint.id),
    onSuccess: (updated) => {
      toast.add("success", updated.disabled ? "Endpoint disabled" : "Endpoint enabled");
      invalidate();
    },
    onError: (err: unknown) => toast.add("error", errMessage(err, "Failed to update endpoint")),
  });

  // Send example test delivery.
  const [exampleType, setExampleType] = useState("");
  const sendExampleMutation = useMutation({
    mutationFn: () => sendExample(app, endpoint.id, { eventType: exampleType }),
    onSuccess: (result) => {
      if (result.outcome.ok) {
        toast.add(
          "success",
          "Example delivered",
          `HTTP ${result.outcome.httpStatus} in ${Math.round(result.outcome.durationMs)} ms`,
        );
      } else {
        toast.add(
          "error",
          "Example delivery failed",
          result.outcome.httpStatus
            ? `HTTP ${result.outcome.httpStatus}`
            : (result.outcome.error ?? "network error"),
        );
      }
      qc.invalidateQueries({ queryKey: ["deliveries", app] });
    },
    onError: (err: unknown) => toast.add("error", errMessage(err, "Failed to send example")),
  });

  // Recover: redrive failed deliveries since a timestamp.
  const [recoverSince, setRecoverSince] = useState("");
  const [recoverOpen, setRecoverOpen] = useState(false);
  const recoverMutation = useMutation({
    mutationFn: () =>
      recoverEndpoint(app, endpoint.id, { since: new Date(recoverSince).toISOString() }),
    onSuccess: (result) => {
      setRecoverOpen(false);
      toast.add(
        "success",
        `Recovered ${result.deliveryIds.length} deliver${result.deliveryIds.length === 1 ? "y" : "ies"}`,
        "Failed deliveries were re-queued for immediate retry.",
      );
      qc.invalidateQueries({ queryKey: ["deliveries", app] });
    },
    onError: (err: unknown) => toast.add("error", errMessage(err, "Failed to recover deliveries")),
  });

  // Type-to-confirm delete (flags pattern).
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const deleteMutation = useMutation({
    mutationFn: () => deleteEndpoint(app, endpoint.id),
    onSuccess: () => {
      toast.add("success", "Endpoint deleted");
      invalidate();
      setDeleteOpen(false);
      onBack();
    },
    onError: (err: unknown) => toast.add("error", errMessage(err, "Failed to delete endpoint")),
  });

  const deliveries = deliveriesQuery.data ?? [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <button
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Endpoints
      </button>

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="break-all font-mono text-xl font-semibold tracking-tight">{endpoint.url}</h1>
        {endpoint.disabled ? (
          <Badge className="border-destructive/30 bg-destructive/10 text-destructive">
            Disabled ({endpoint.disabledReason ?? "manual"})
          </Badge>
        ) : (
          <Badge className="border-success/30 bg-success/10 text-success">Active</Badge>
        )}
        {endpoint.firstFailingAt ? (
          <Badge className="border-warning/30 bg-warning/10 text-warning">
            Failing since {formatDateTime(endpoint.firstFailingAt)}
          </Badge>
        ) : null}
      </div>
      <p className="mt-1 font-mono text-xs text-muted-foreground">{endpoint.id}</p>

      <div className="mt-6 flex flex-col gap-5">
        {/* ── Settings ─────────────────────────────────────────────────── */}
        <SectionCard
          title="Settings"
          description="Destination URL, subscriptions, and custom headers."
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ep-url" className="text-xs font-medium text-muted-foreground">
                URL
              </label>
              <TextInput
                id="ep-url"
                className="font-mono"
                value={draft.url}
                disabled={readonly}
                onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ep-desc" className="text-xs font-medium text-muted-foreground">
                Description
              </label>
              <TextInput
                id="ep-desc"
                placeholder="What receives these webhooks?"
                value={draft.description}
                disabled={readonly}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Subscribed event types
              </span>
              <p className="text-xs text-muted-foreground/70">
                None selected = the endpoint receives <em>all</em> event types.
              </p>
              {catalog.length === 0 ? (
                <p className="text-xs text-muted-foreground">The event-type catalog is empty.</p>
              ) : (
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {catalog.map((type) => {
                    const checked = draft.eventTypes.includes(type.name);
                    return (
                      <label
                        key={type.name}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-[13px] transition-colors",
                          checked
                            ? "border-accent/40 bg-accent/10 text-foreground"
                            : "border-border bg-secondary/30 text-muted-foreground hover:text-foreground",
                          readonly && "cursor-not-allowed opacity-60",
                        )}
                      >
                        <input
                          type="checkbox"
                          className="accent-[var(--accent)]"
                          checked={checked}
                          disabled={readonly}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              eventTypes: e.target.checked
                                ? [...draft.eventTypes, type.name]
                                : draft.eventTypes.filter((n) => n !== type.name),
                            })
                          }
                        />
                        <span className="truncate font-mono">{type.name}</span>
                        {type.deprecated ? (
                          <span className="ml-auto text-[10px] uppercase text-warning">
                            deprecated
                          </span>
                        ) : null}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Custom headers</span>
              <HeadersEditor
                rows={draft.headers}
                onChange={(headers) => setDraft({ ...draft, headers })}
                readonly={readonly}
              />
            </div>

            {!readonly && (
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  disabled={!dirty}
                  loading={saveMutation.isPending}
                  onClick={() => saveMutation.mutate()}
                >
                  Save changes
                </Button>
                {dirty && (
                  <>
                    <Button variant="secondary" onClick={() => setDraft(saved)}>
                      Revert
                    </Button>
                    <span className="flex items-center gap-1.5 text-xs font-medium text-warning">
                      <span className="size-2 rounded-full bg-warning" aria-hidden />
                      Unsaved changes
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        </SectionCard>

        {/* ── Signing secret ───────────────────────────────────────────── */}
        <SectionCard
          title="Signing secret"
          description="Standard Webhooks whsec_ secret used to sign every delivery."
        >
          <div className="flex flex-col gap-3">
            {secrets === null ? (
              <div>
                <Button
                  variant="secondary"
                  loading={revealMutation.isPending}
                  onClick={() => revealMutation.mutate()}
                >
                  Reveal secret
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {secrets.map((s, i) => (
                  <div key={s.secret} className="flex flex-col gap-1">
                    <SecretBlock
                      secret={s.secret}
                      testId={i === 0 ? "current-secret" : undefined}
                    />
                    <p className="text-xs text-muted-foreground">
                      {i === 0
                        ? `Current — created ${formatDateTime(s.createdAt)}`
                        : `Previous — still verifying until ${formatDateTime(s.expiresAt)}`}
                    </p>
                  </div>
                ))}
              </div>
            )}
            {!readonly && (
              <div>
                <Button
                  variant="secondary"
                  icon={<RefreshCw className="size-3.5" />}
                  onClick={() => setRotateOpen(true)}
                >
                  Rotate secret
                </Button>
              </div>
            )}
          </div>
        </SectionCard>

        {/* ── Send example ─────────────────────────────────────────────── */}
        {!readonly && (
          <SectionCard
            title="Send example"
            description="Fire a one-off signed test delivery through the real wire path."
          >
            <div className="flex flex-wrap items-center gap-2">
              <Dropdown
                aria-label="Example event type"
                value={exampleType}
                onValueChange={setExampleType}
                options={catalog.map((t) => ({ value: t.name, label: t.name }))}
                placeholder="Choose event type…"
                className="w-64"
              />
              <Button
                variant="secondary"
                icon={<Send className="size-3.5" />}
                disabled={!exampleType}
                loading={sendExampleMutation.isPending}
                onClick={() => sendExampleMutation.mutate()}
              >
                Send example
              </Button>
            </div>
          </SectionCard>
        )}

        {/* ── Recover ──────────────────────────────────────────────────── */}
        {!readonly && (
          <SectionCard
            title="Recover"
            description="Re-queue every dead-lettered delivery for this endpoint created at or after a point in time."
          >
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="datetime-local"
                aria-label="Recover since"
                value={recoverSince}
                onChange={(e) => setRecoverSince(e.target.value)}
                className="h-9 rounded-md border border-input bg-secondary/40 px-3 text-[13px] text-foreground outline-none hover:bg-secondary/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button
                variant="secondary"
                disabled={!recoverSince}
                onClick={() => setRecoverOpen(true)}
              >
                Recover
              </Button>
            </div>
          </SectionCard>
        )}

        {/* ── Recent deliveries ────────────────────────────────────────── */}
        <SectionCard
          title="Recent deliveries"
          description="The latest deliveries to this endpoint."
        >
          {deliveriesQuery.isLoading ? (
            <p className="text-[13px] text-muted-foreground">Loading deliveries…</p>
          ) : deliveries.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No deliveries yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {deliveries.map((d) => (
                <li key={d.id}>
                  <button
                    onClick={() => onOpenDelivery(d.id)}
                    className="group flex w-full items-center gap-3 py-2.5 text-left"
                  >
                    <DeliveryStatusBadge status={d.status} />
                    <Mono className="min-w-0 flex-1 truncate">{d.id}</Mono>
                    <span className="text-xs text-muted-foreground">
                      {d.attemptCount} attempt{d.attemptCount === 1 ? "" : "s"}
                    </span>
                    <span
                      className="whitespace-nowrap text-xs tabular-nums text-muted-foreground"
                      title={formatDateTime(d.updatedAt)}
                    >
                      {relativeTime(d.updatedAt)}
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground/50 group-hover:text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {/* ── Danger zone ──────────────────────────────────────────────── */}
        {!readonly && (
          <SectionCard title="Danger zone">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                loading={toggleMutation.isPending}
                onClick={() => toggleMutation.mutate()}
              >
                {endpoint.disabled ? "Enable endpoint" : "Disable endpoint"}
              </Button>
              <Button
                variant="danger"
                icon={<Trash2 className="size-3.5" />}
                onClick={() => {
                  setConfirmText("");
                  setDeleteOpen(true);
                }}
              >
                Delete endpoint
              </Button>
            </div>
          </SectionCard>
        )}
      </div>

      {/* Rotate confirmation */}
      <ConfirmDialog
        open={rotateOpen}
        onClose={() => setRotateOpen(false)}
        onConfirm={() => rotateMutation.mutate()}
        title="Rotate signing secret"
        confirmLabel="Rotate secret"
        loading={rotateMutation.isPending}
      >
        <p className="text-[13px] text-muted-foreground">
          A new signing secret is minted immediately. The current secret keeps verifying until its
          grace window expires (default 24 hours), and deliveries carry both signatures during grace
          — receivers can migrate without dropping webhooks.
        </p>
      </ConfirmDialog>

      {/* Recover confirmation */}
      <ConfirmDialog
        open={recoverOpen}
        onClose={() => setRecoverOpen(false)}
        onConfirm={() => recoverMutation.mutate()}
        title="Recover failed deliveries"
        confirmLabel="Recover deliveries"
        loading={recoverMutation.isPending}
      >
        <p className="text-[13px] text-muted-foreground">
          Every dead-lettered delivery for this endpoint created at or after{" "}
          <span className="font-mono text-foreground">
            {recoverSince ? formatDateTime(new Date(recoverSince).toISOString()) : "—"}
          </span>{" "}
          is re-queued for immediate retry.
        </p>
      </ConfirmDialog>

      {/* Type-to-confirm delete */}
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
        title="Delete endpoint"
        confirmLabel="Delete permanently"
        danger
        loading={deleteMutation.isPending}
        confirmDisabled={confirmText !== endpoint.id}
      >
        <p className="text-[13px] text-muted-foreground">
          This permanently removes the endpoint and stops all deliveries to{" "}
          <code className="break-all font-mono text-foreground">{endpoint.url}</code>. Pending
          deliveries for it become terminal. This can't be undone.
        </p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ep-delete-confirm" className="text-xs font-medium text-muted-foreground">
            Type <code className="font-mono text-foreground">{endpoint.id}</code> to confirm
          </label>
          <TextInput
            id="ep-delete-confirm"
            className="font-mono"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoFocus
          />
        </div>
      </ConfirmDialog>
    </div>
  );
}

/* ─── List + create ─────────────────────────────────────────────────────────── */

export function EndpointsView({
  app,
  readonly,
  selectedId,
  onOpen,
  onBack,
  onOpenDelivery,
}: Props) {
  const toast = useToast();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["endpoints", app],
    queryFn: () => listEndpoints(app),
    staleTime: 10_000,
    enabled: app !== "",
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newDescription, setNewDescription] = useState("");
  // The create response is the ONE response carrying the signing secret — it is
  // surfaced once in a dialog and never rendered again outside "Reveal secret".
  const [mintedSecret, setMintedSecret] = useState<{ id: string; secret: string } | null>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      createEndpoint(app, { url: newUrl, description: newDescription || undefined }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["endpoints", app] });
      setCreateOpen(false);
      setNewUrl("");
      setNewDescription("");
      setMintedSecret({ id: created.id, secret: created.secrets[0]?.secret ?? "" });
    },
    onError: (err: unknown) => toast.add("error", errMessage(err, "Failed to create endpoint")),
  });

  if (!app) return <NoApplication />;

  const endpoints = query.data ?? [];
  const selected = selectedId ? endpoints.find((e) => e.id === selectedId) : undefined;

  if (selected) {
    return (
      <EndpointDetail
        app={app}
        endpoint={selected}
        readonly={readonly}
        onBack={onBack}
        onOpenDelivery={onOpenDelivery}
      />
    );
  }
  if (selectedId && query.isLoading) {
    return <LoadingRow label="Loading endpoint…" />;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Endpoints"
        description={`${endpoints.length} endpoint${endpoints.length === 1 ? "" : "s"} receiving webhooks for this application.`}
        actions={
          !readonly ? (
            <Button
              variant="primary"
              icon={<Plus className="size-4" />}
              onClick={() => setCreateOpen(true)}
            >
              New endpoint
            </Button>
          ) : undefined
        }
      />

      {query.isLoading ? (
        <LoadingRow label="Loading endpoints…" />
      ) : query.isError ? (
        <EmptyCard>Failed to load endpoints.</EmptyCard>
      ) : endpoints.length === 0 ? (
        <EmptyCard>
          No endpoints yet. Register a customer URL to start delivering webhooks.
        </EmptyCard>
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
          <ul className="divide-y divide-border">
            {endpoints.map((endpoint) => (
              <li key={endpoint.id}>
                <button
                  onClick={() => onOpen(endpoint.id)}
                  className="group flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-secondary/30"
                >
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      endpoint.disabled ? "bg-muted-foreground/40" : "bg-success",
                    )}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono text-[13px] font-medium text-foreground">
                        {endpoint.url}
                      </span>
                      {endpoint.disabled && (
                        <Badge className="border-destructive/30 bg-destructive/10 text-destructive">
                          Disabled ({endpoint.disabledReason ?? "manual"})
                        </Badge>
                      )}
                      {endpoint.firstFailingAt && !endpoint.disabled && (
                        <Badge className="border-warning/30 bg-warning/10 text-warning">
                          Failing
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      <span className="font-mono">{endpoint.id}</span>
                      {endpoint.description ? ` · ${endpoint.description}` : ""}
                      {endpoint.firstFailingAt
                        ? ` · failing since ${formatDateTime(endpoint.firstFailingAt)}`
                        : ""}
                    </p>
                  </div>
                  <div className="hidden items-center gap-1.5 lg:flex">
                    {(endpoint.eventTypes ?? []).length === 0 ? (
                      <Badge>All events</Badge>
                    ) : (
                      (endpoint.eventTypes ?? []).slice(0, 3).map((name) => (
                        <span
                          key={name}
                          className="rounded-md bg-secondary/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                        >
                          {name}
                        </span>
                      ))
                    )}
                    {(endpoint.eventTypes ?? []).length > 3 && (
                      <span className="text-[11px] text-muted-foreground">
                        +{(endpoint.eventTypes ?? []).length - 3}
                      </span>
                    )}
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Create dialog */}
      <ModalDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New endpoint"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!newUrl.trim()}
              loading={createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              Create endpoint
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-muted-foreground">
          Register a URL to receive signed webhook deliveries. A signing secret is minted on
          creation and shown once.
        </p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="new-ep-url" className="text-xs font-medium text-muted-foreground">
            URL
          </label>
          <TextInput
            id="new-ep-url"
            className="font-mono"
            placeholder="https://example.com/webhooks"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            autoFocus
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="new-ep-desc" className="text-xs font-medium text-muted-foreground">
            Description (optional)
          </label>
          <TextInput
            id="new-ep-desc"
            placeholder="What receives these webhooks?"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
          />
        </div>
      </ModalDialog>

      {/* Secret-shown-once dialog */}
      <ModalDialog
        open={mintedSecret !== null}
        onClose={() => {
          const id = mintedSecret?.id;
          setMintedSecret(null);
          if (id) onOpen(id);
        }}
        title="Endpoint created"
        footer={
          <Button
            variant="primary"
            onClick={() => {
              const id = mintedSecret?.id;
              setMintedSecret(null);
              if (id) onOpen(id);
            }}
          >
            I saved the secret
          </Button>
        }
      >
        <p className="text-[13px] text-muted-foreground">
          This is the endpoint's signing secret. Hand it to the receiver team now — it is shown only
          this once (afterwards it is only reachable via "Reveal secret").
        </p>
        <SecretBlock secret={mintedSecret?.secret ?? ""} testId="endpoint-secret" />
      </ModalDialog>
    </div>
  );
}
