import React from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight } from "lucide-react";
import type { Message } from "../types.ts";
import { getMessage, listEventTypes, listMessages } from "../api.ts";
import { Button } from "../components/ui-bits.tsx";
import { Dropdown } from "../components/primitives.tsx";
import { JsonCodeEditor } from "../components/JsonCodeEditor.tsx";
import {
  DeliveryStatusBadge,
  EmptyCard,
  LoadingRow,
  Mono,
  NoApplication,
  PageHeader,
  SectionCard,
} from "../components/webhook-bits.tsx";
import { formatDateTime, relativeTime } from "../lib/format.ts";

const PAGE_SIZE = 50;

interface Props {
  app: string;
  selectedId?: string;
  onOpen: (id: string) => void;
  onBack: () => void;
  onOpenDelivery: (id: string) => void;
}

function prettyEnvelope(message: Message): string {
  try {
    return JSON.stringify(JSON.parse(message.envelope), null, 2);
  } catch {
    return message.envelope;
  }
}

function MessageDetail({
  app,
  id,
  onBack,
  onOpenDelivery,
}: {
  app: string;
  id: string;
  onBack: () => void;
  onOpenDelivery: (id: string) => void;
}) {
  const query = useQuery({
    queryKey: ["messages", app, { id }],
    queryFn: () => getMessage(app, id),
  });

  if (query.isLoading) return <LoadingRow label="Loading message…" />;
  if (query.isError || !query.data) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <EmptyCard>Message not found.</EmptyCard>
      </div>
    );
  }
  const message = query.data;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <button
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Messages
      </button>

      <div className="flex flex-wrap items-baseline gap-2">
        <h1 className="font-mono text-xl font-semibold tracking-tight">{message.eventType}</h1>
        <Mono className="text-muted-foreground">{message.id}</Mono>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Published {formatDateTime(message.createdAt)} · event time{" "}
        {formatDateTime(message.timestamp)} · the message id is the{" "}
        <code className="font-mono">webhook-id</code> header (receivers dedupe on it)
        {message.idempotencyKey ? (
          <>
            {" "}
            · idempotency key <span className="font-mono">{message.idempotencyKey}</span>
          </>
        ) : null}
      </p>

      <div className="mt-6 flex flex-col gap-5">
        <SectionCard
          title="Envelope"
          description="The exact signed bytes every delivery of this message carries."
        >
          <JsonCodeEditor value={prettyEnvelope(message)} onChange={() => {}} readOnly />
        </SectionCard>

        <SectionCard title="Deliveries" description="One delivery per matching endpoint (fan-out).">
          {message.deliveries.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              No deliveries — no enabled endpoint matched this event type at publish time.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {message.deliveries.map((d) => (
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
      </div>
    </div>
  );
}

export function MessagesView({ app, selectedId, onOpen, onBack, onOpenDelivery }: Props) {
  const [eventType, setEventType] = React.useState("");

  const catalogQuery = useQuery({ queryKey: ["event-types"], queryFn: listEventTypes });
  const catalog = catalogQuery.data ?? [];

  // Cursor pagination: `before` = the last message id of the previous page.
  const query = useInfiniteQuery({
    queryKey: ["messages", app, { eventType }],
    queryFn: ({ pageParam }) =>
      listMessages(app, {
        limit: PAGE_SIZE,
        ...(eventType ? { eventType } : {}),
        ...(pageParam ? { before: pageParam } : {}),
      }),
    initialPageParam: "",
    getNextPageParam: (lastPage) =>
      lastPage.length === PAGE_SIZE ? lastPage[lastPage.length - 1]?.id : undefined,
    enabled: app !== "" && !selectedId,
  });

  if (!app) return <NoApplication />;

  if (selectedId) {
    return (
      <MessageDetail app={app} id={selectedId} onBack={onBack} onOpenDelivery={onOpenDelivery} />
    );
  }

  const messages = query.data?.pages.flat() ?? [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Messages"
        description="Every published event, newest first. A message's payload is signed once and shared by all its deliveries."
      />

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Dropdown
          aria-label="Filter by event type"
          value={eventType}
          onValueChange={setEventType}
          options={[
            { value: "", label: "All event types" },
            ...catalog.map((t) => ({ value: t.name, label: t.name })),
          ]}
          className="w-64"
        />
      </div>

      {query.isLoading ? (
        <LoadingRow label="Loading messages…" />
      ) : query.isError ? (
        <EmptyCard>Failed to load messages.</EmptyCard>
      ) : messages.length === 0 ? (
        <EmptyCard>
          {eventType ? `No messages of type "${eventType}".` : "No messages published yet."}
        </EmptyCard>
      ) : (
        <>
          <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
            <ul className="divide-y divide-border">
              {messages.map((message) => (
                <li key={message.id}>
                  <button
                    onClick={() => onOpen(message.id)}
                    className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/30"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[13px] font-medium text-foreground">
                        {message.eventType}
                      </span>
                      <Mono className="mt-0.5 block truncate text-muted-foreground">
                        {message.id}
                      </Mono>
                    </div>
                    <span
                      className="whitespace-nowrap text-xs tabular-nums text-muted-foreground"
                      title={formatDateTime(message.createdAt)}
                    >
                      {relativeTime(message.createdAt)}
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
