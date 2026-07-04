import React, { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import type { EventType } from "../types.ts";
import { WebhooksApiError } from "../types.ts";
import { deleteEventType, listEventTypes, updateEventType, upsertEventType } from "../api.ts";
import { useToast } from "../components/Toast.tsx";
import { Button, Badge } from "../components/ui-bits.tsx";
import { ToggleSwitch, TextInput } from "../components/primitives.tsx";
import { JsonCodeEditor } from "../components/JsonCodeEditor.tsx";
import {
  ConfirmDialog,
  EmptyCard,
  LoadingRow,
  ModalDialog,
  PageHeader,
  SectionCard,
} from "../components/webhook-bits.tsx";
import { groupEventTypes } from "../lib/format.ts";
import { clearNavBlocker, setNavBlocker } from "../lib/nav-guard.ts";

interface Props {
  readonly: boolean;
  /** Portal mode: catalog is read-only and the public-catalog note is emphasized. */
  portal: boolean;
  selectedName?: string;
  onOpen: (name: string) => void;
  onBack: () => void;
}

const errMessage = (err: unknown, fallback: string): string =>
  err instanceof WebhooksApiError ? err.body.error : fallback;

interface Draft {
  description: string;
  groupName: string;
  schemaText: string;
  deprecated: boolean;
}

const toDraft = (type: EventType): Draft => ({
  description: type.description ?? "",
  groupName: type.groupName ?? "",
  schemaText: type.schema !== undefined ? JSON.stringify(type.schema, null, 2) : "",
  deprecated: type.deprecated ?? false,
});

const draftEquals = (a: Draft, b: Draft): boolean =>
  a.description === b.description &&
  a.groupName === b.groupName &&
  a.schemaText === b.schemaText &&
  a.deprecated === b.deprecated;

function EventTypeDetail({
  type,
  readonly,
  onBack,
}: {
  type: EventType;
  readonly: boolean;
  onBack: () => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();

  const [draft, setDraft] = useState<Draft>(() => toDraft(type));
  const saved = toDraft(type);
  const dirty = !draftEquals(draft, saved);

  useEffect(() => {
    setDraft(toDraft(type));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type.name]);

  useEffect(() => {
    const blocker = () => !dirty || window.confirm("Discard unsaved event-type changes?");
    setNavBlocker(blocker);
    return () => clearNavBlocker(blocker);
  }, [dirty]);

  let schemaError: string | null = null;
  let parsedSchema: unknown;
  if (draft.schemaText.trim() !== "") {
    try {
      parsedSchema = JSON.parse(draft.schemaText);
    } catch {
      schemaError = "Schema is not valid JSON";
    }
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      updateEventType(type.name, {
        name: type.name,
        description: draft.description || undefined,
        groupName: draft.groupName || undefined,
        deprecated: draft.deprecated || undefined,
        ...(draft.schemaText.trim() !== "" ? { schema: parsedSchema as EventType["schema"] } : {}),
      }),
    onSuccess: () => {
      toast.add("success", "Event type saved");
      qc.invalidateQueries({ queryKey: ["event-types"] });
    },
    onError: (err: unknown) => toast.add("error", errMessage(err, "Failed to save event type")),
  });

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const deleteMutation = useMutation({
    mutationFn: () => deleteEventType(type.name),
    onSuccess: () => {
      toast.add("success", "Event type deleted");
      qc.invalidateQueries({ queryKey: ["event-types"] });
      setDeleteOpen(false);
      onBack();
    },
    onError: (err: unknown) => toast.add("error", errMessage(err, "Failed to delete event type")),
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <button
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Event Types
      </button>

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-mono text-xl font-semibold tracking-tight">{type.name}</h1>
        {(readonly ? type.deprecated : draft.deprecated) && (
          <Badge className="border-warning/30 bg-warning/10 text-warning">Deprecated</Badge>
        )}
      </div>

      <div className="mt-6 flex flex-col gap-5">
        <SectionCard title="Details">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="et-desc" className="text-xs font-medium text-muted-foreground">
                Description
              </label>
              <TextInput
                id="et-desc"
                placeholder="What does this event mean?"
                value={draft.description}
                disabled={readonly}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="et-group" className="text-xs font-medium text-muted-foreground">
                Group
              </label>
              <TextInput
                id="et-group"
                placeholder="Billing"
                value={draft.groupName}
                disabled={readonly}
                onChange={(e) => setDraft({ ...draft, groupName: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-3">
              <ToggleSwitch
                checked={draft.deprecated}
                onCheckedChange={(deprecated) => !readonly && setDraft({ ...draft, deprecated })}
                disabled={readonly}
                aria-label="Deprecated"
              />
              <div>
                <p className="text-[13px] font-medium text-foreground">Deprecated</p>
                <p className="text-xs text-muted-foreground">
                  Flagged in the UI but still deliverable.
                </p>
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Payload schema"
          description="Optional JSON Schema documenting the payload. Enforced only when the core is configured with a payload validator."
        >
          <JsonCodeEditor
            value={draft.schemaText}
            onChange={(schemaText) => !readonly && setDraft({ ...draft, schemaText })}
            readOnly={readonly}
            placeholderText='{ "type": "object" }'
          />
          {schemaError && <p className="mt-2 text-xs text-destructive">{schemaError}</p>}
        </SectionCard>

        {!readonly && (
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              disabled={!dirty || schemaError !== null}
              loading={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              Save changes
            </Button>
            {dirty && (
              <Button variant="secondary" onClick={() => setDraft(saved)}>
                Revert
              </Button>
            )}
            <div className="ml-auto">
              <Button
                variant="danger"
                icon={<Trash2 className="size-3.5" />}
                onClick={() => {
                  setConfirmText("");
                  setDeleteOpen(true);
                }}
              >
                Delete event type
              </Button>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
        title="Delete event type"
        confirmLabel="Delete permanently"
        danger
        loading={deleteMutation.isPending}
        confirmDisabled={confirmText !== type.name}
      >
        <p className="text-[13px] text-muted-foreground">
          Endpoints subscribed to <code className="font-mono text-foreground">{type.name}</code>{" "}
          keep their subscription entry and simply stop matching new publishes of this name. This
          can't be undone.
        </p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="et-delete-confirm" className="text-xs font-medium text-muted-foreground">
            Type <code className="font-mono text-foreground">{type.name}</code> to confirm
          </label>
          <TextInput
            id="et-delete-confirm"
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

export function EventTypesView({ readonly, portal, selectedName, onOpen, onBack }: Props) {
  const toast = useToast();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["event-types"],
    queryFn: listEventTypes,
    staleTime: 10_000,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const createMutation = useMutation({
    mutationFn: () => upsertEventType({ name: newName.trim() }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["event-types"] });
      setCreateOpen(false);
      setNewName("");
      onOpen(created.name);
    },
    onError: (err: unknown) => toast.add("error", errMessage(err, "Failed to create event type")),
  });

  const catalog = query.data ?? [];
  const selected = selectedName ? catalog.find((t) => t.name === selectedName) : undefined;

  if (selected) {
    return <EventTypeDetail type={selected} readonly={readonly} onBack={onBack} />;
  }
  if (selectedName && query.isLoading) {
    return <LoadingRow label="Loading event type…" />;
  }

  const groups = groupEventTypes(catalog);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Event Types"
        description={
          <>
            The global catalog{portal ? " (read-only in the portal)" : ""} — public at{" "}
            <code className="font-mono text-foreground">api/event-types.json</code> so receiver
            teams can browse it without panel credentials.
          </>
        }
        actions={
          !readonly ? (
            <Button
              variant="primary"
              icon={<Plus className="size-4" />}
              onClick={() => setCreateOpen(true)}
            >
              New event type
            </Button>
          ) : undefined
        }
      />

      {query.isLoading ? (
        <LoadingRow label="Loading event types…" />
      ) : query.isError ? (
        <EmptyCard>Failed to load event types.</EmptyCard>
      ) : catalog.length === 0 ? (
        <EmptyCard>
          No event types yet. Define the kinds of events your applications publish.
        </EmptyCard>
      ) : (
        <div className="mt-4 flex flex-col gap-6">
          {groups.map(({ group, types }) => (
            <div key={group}>
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group}
              </h2>
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <ul className="divide-y divide-border">
                  {types.map((type) => (
                    <li key={type.name}>
                      <button
                        onClick={() => onOpen(type.name)}
                        className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/30"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-mono text-[13px] font-medium text-foreground">
                              {type.name}
                            </span>
                            {type.deprecated && (
                              <Badge className="border-warning/30 bg-warning/10 text-warning">
                                Deprecated
                              </Badge>
                            )}
                            {type.schema !== undefined && <Badge>Schema</Badge>}
                          </div>
                          {type.description && (
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">
                              {type.description}
                            </p>
                          )}
                        </div>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      )}

      <ModalDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New event type"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!newName.trim()}
              loading={createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              Create event type
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-muted-foreground">
          Dot-delimited, e.g. <code className="font-mono text-foreground">invoice.paid</code>.
          Endpoints subscribe to event types by name.
        </p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="new-et-name" className="text-xs font-medium text-muted-foreground">
            Name
          </label>
          <TextInput
            id="new-et-name"
            className="font-mono"
            placeholder="invoice.paid"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim() && !createMutation.isPending) {
                createMutation.mutate();
              }
            }}
            autoFocus
          />
        </div>
      </ModalDialog>
    </div>
  );
}
