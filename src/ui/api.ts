import type {
  Application,
  AuditEntry,
  Delivery,
  DeliveryDetail,
  DeliveryStatus,
  EndpointSecret,
  EndpointSummary,
  EventType,
  JsonValue,
  Message,
  MessageDetail,
  PublishResponse,
  RecoverResponse,
  SendExampleResponse,
  SignedRequest,
  WebhooksConfig,
} from "./types.ts";
import { createApiClient, type ApiClient } from "@xtandard/kit/ui";
import { WebhooksApiError } from "./types.ts";

/**
 * The webhooks API client (`@xtandard/kit/ui`'s): a base URL (empty by default,
 * so the bundled SPA uses relative URLs resolved against the injected
 * `<base href>`), the `credentials` mode, an optional custom `fetch`, and the
 * portal token sent as `Authorization: Bearer whpt_…`. Non-2xx responses throw
 * {@link WebhooksApiError}. Each product has its own client, so two dashboards
 * on one page never share a base URL or token.
 */
const client = createApiClient({ errorClass: WebhooksApiError });

export type { ApiClientOptions, FetchLike } from "@xtandard/kit/ui";

/** Point the API client at a base URL (used by the `@xtandard/webhooks/react` export). */
export const setApiBase: ApiClient["setApiBase"] = client.setApiBase;

/** Attach a portal token (`whpt_…`) as a Bearer credential on every request. */
export const setApiToken: ApiClient["setApiToken"] = client.setApiToken;

/** The attached portal token, if any. */
export const getApiToken: ApiClient["getApiToken"] = client.getApiToken;

const req = client.req;

const appBase = (app: string): string => `api/applications/${encodeURIComponent(app)}`;

const query = client.query;

/* ─── Config ────────────────────────────────────────────────────────────────── */

export function getConfig(): Promise<WebhooksConfig> {
  return req<WebhooksConfig>("config");
}

/* ─── Applications ──────────────────────────────────────────────────────────── */

export function listApplications(): Promise<Application[]> {
  return req<Application[]>("api/applications");
}

export function createApplication(input: {
  key: string;
  name?: string;
  metadata?: JsonValue;
}): Promise<Application> {
  return req<Application>("api/applications", { method: "POST", body: JSON.stringify(input) });
}

export function updateApplication(
  app: string,
  patch: { name?: string; metadata?: JsonValue },
): Promise<Application> {
  return req<Application>(appBase(app), { method: "PUT", body: JSON.stringify(patch) });
}

export function deleteApplication(app: string): Promise<{ ok: boolean }> {
  return req<{ ok: boolean }>(appBase(app), { method: "DELETE" });
}

/* ─── Event types (global catalog) ──────────────────────────────────────────── */

export function listEventTypes(): Promise<EventType[]> {
  return req<EventType[]>("api/event-types");
}

export function upsertEventType(input: EventType): Promise<EventType> {
  return req<EventType>("api/event-types", { method: "POST", body: JSON.stringify(input) });
}

export function updateEventType(name: string, input: EventType): Promise<EventType> {
  return req<EventType>(`api/event-types/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function deleteEventType(name: string): Promise<{ ok: boolean }> {
  return req<{ ok: boolean }>(`api/event-types/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}

/* ─── Endpoints ─────────────────────────────────────────────────────────────── */

export interface EndpointInput {
  url: string;
  description?: string;
  eventTypes?: string[];
  headers?: Record<string, string>;
  metadata?: JsonValue;
  disabled?: boolean;
}

export function listEndpoints(app: string): Promise<EndpointSummary[]> {
  return req<EndpointSummary[]>(`${appBase(app)}/endpoints`);
}

export function getEndpoint(app: string, id: string): Promise<EndpointSummary> {
  return req<EndpointSummary>(`${appBase(app)}/endpoints/${encodeURIComponent(id)}`);
}

/** The one response carrying `secrets` — capture the signing secret now. */
export function createEndpoint(
  app: string,
  input: EndpointInput,
): Promise<EndpointSummary & { secrets: EndpointSecret[] }> {
  return req<EndpointSummary & { secrets: EndpointSecret[] }>(`${appBase(app)}/endpoints`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateEndpoint(
  app: string,
  id: string,
  patch: Partial<Omit<EndpointInput, "disabled">>,
): Promise<EndpointSummary> {
  return req<EndpointSummary>(`${appBase(app)}/endpoints/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

export function deleteEndpoint(app: string, id: string): Promise<{ ok: boolean }> {
  return req<{ ok: boolean }>(`${appBase(app)}/endpoints/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function getEndpointSecrets(app: string, id: string): Promise<EndpointSecret[]> {
  return req<EndpointSecret[]>(`${appBase(app)}/endpoints/${encodeURIComponent(id)}/secret`);
}

/** Rotation mints a secret the caller must capture — the response includes `secrets`. */
export function rotateEndpointSecret(
  app: string,
  id: string,
): Promise<EndpointSummary & { secrets: EndpointSecret[] }> {
  return req<EndpointSummary & { secrets: EndpointSecret[] }>(
    `${appBase(app)}/endpoints/${encodeURIComponent(id)}/rotate-secret`,
    { method: "POST" },
  );
}

export function enableEndpoint(app: string, id: string): Promise<EndpointSummary> {
  return req<EndpointSummary>(`${appBase(app)}/endpoints/${encodeURIComponent(id)}/enable`, {
    method: "POST",
  });
}

export function disableEndpoint(app: string, id: string): Promise<EndpointSummary> {
  return req<EndpointSummary>(`${appBase(app)}/endpoints/${encodeURIComponent(id)}/disable`, {
    method: "POST",
  });
}

/** Fire a one-off signed test delivery through the real wire path. */
export function sendExample(
  app: string,
  id: string,
  input: { eventType: string; payload?: JsonValue },
): Promise<SendExampleResponse> {
  return req<SendExampleResponse>(`${appBase(app)}/endpoints/${encodeURIComponent(id)}/test`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Re-queue every failed delivery for the endpoint created at/after `since`. */
export function recoverEndpoint(
  app: string,
  id: string,
  input: { since: string },
): Promise<RecoverResponse> {
  return req<RecoverResponse>(`${appBase(app)}/endpoints/${encodeURIComponent(id)}/recover`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/* ─── Messages ──────────────────────────────────────────────────────────────── */

export interface ListMessagesFilters {
  eventType?: string;
  before?: string;
  limit?: number;
}

export function listMessages(app: string, filters: ListMessagesFilters = {}): Promise<Message[]> {
  return req<Message[]>(`${appBase(app)}/messages${query({ ...filters })}`);
}

export function getMessage(app: string, id: string): Promise<MessageDetail> {
  return req<MessageDetail>(`${appBase(app)}/messages/${encodeURIComponent(id)}`);
}

export function publishMessage(
  app: string,
  input: { eventType: string; payload: JsonValue; timestamp?: string; idempotencyKey?: string },
): Promise<PublishResponse> {
  return req<PublishResponse>(`${appBase(app)}/messages`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/* ─── Deliveries ────────────────────────────────────────────────────────────── */

export interface ListDeliveriesFilters {
  status?: DeliveryStatus;
  endpoint?: string;
  before?: string;
  limit?: number;
}

export function listDeliveries(
  app: string,
  filters: ListDeliveriesFilters = {},
): Promise<Delivery[]> {
  return req<Delivery[]>(`${appBase(app)}/deliveries${query({ ...filters })}`);
}

export function getDelivery(app: string, id: string): Promise<DeliveryDetail> {
  return req<DeliveryDetail>(`${appBase(app)}/deliveries/${encodeURIComponent(id)}`);
}

/**
 * The exact signed HTTP request this delivery sends. The signature and
 * `webhook-timestamp` are computed live (each attempt re-signs).
 */
export function getDeliveryRequest(app: string, id: string): Promise<SignedRequest> {
  return req<SignedRequest>(`${appBase(app)}/deliveries/${encodeURIComponent(id)}/request`);
}

/** Re-queue a dead-lettered delivery (`failed` → `pending`, due immediately). */
export function retryDelivery(app: string, id: string): Promise<Delivery> {
  return req<Delivery>(`${appBase(app)}/deliveries/${encodeURIComponent(id)}/retry`, {
    method: "POST",
  });
}

/* ─── Audit ─────────────────────────────────────────────────────────────────── */

export function listAudit(app: string): Promise<AuditEntry[]> {
  return req<AuditEntry[]>(`${appBase(app)}/audit`);
}
