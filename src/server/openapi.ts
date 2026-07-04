/**
 * OpenAPI 3.1 description of the admin JSON API.
 *
 * Exposed two ways, mirroring the flags panel:
 *  - served at `GET {basePath}/api/openapi.json` for standalone tools (Scalar,
 *    Swagger UI, Postman, codegen);
 *  - returned by `createFetchHandler(...).openapi()` so you can MERGE it into
 *    your host app's OpenAPI document (e.g. Elysia `@elysiajs/openapi`
 *    `references`, or Hono's OpenAPI).
 *
 * Hand-authored — no generation dependency (flags precedent).
 *
 * @module
 */

/** Options for {@link buildOpenApiDocument}. */
export interface OpenApiOptions {
  /** Mount prefix used in the `servers` url (e.g. `"/webhooks"`). */
  basePath?: string;
  /** Document title. */
  title?: string;
  /** Document version (defaults to the package's API version). */
  version?: string;
}

const schemas = {
  Application: {
    type: "object",
    required: ["key"],
    properties: {
      key: { type: "string", pattern: "^[a-zA-Z0-9._-]+$" },
      name: { type: "string" },
      metadata: {},
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
  },
  EventType: {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string", pattern: "^[a-zA-Z0-9._-]+$" },
      description: { type: "string" },
      groupName: { type: "string" },
      schema: { description: "JSON Schema documenting the payload." },
      deprecated: { type: "boolean" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
  },
  EndpointSecret: {
    type: "object",
    required: ["secret", "createdAt"],
    properties: {
      secret: { type: "string", description: '"whsec_" + base64 key material.' },
      createdAt: { type: "string", format: "date-time" },
      expiresAt: {
        type: "string",
        format: "date-time",
        description: "Set on rotation; the secret stops signing after this instant.",
      },
    },
  },
  Endpoint: {
    type: "object",
    required: ["id", "url"],
    description:
      "Read routes strip `secrets`; only the create/rotate responses and the dedicated /secret route carry them.",
    properties: {
      id: { type: "string" },
      url: { type: "string" },
      description: { type: "string" },
      eventTypes: {
        type: "array",
        items: { type: "string" },
        description: "Subscribed event types; empty/absent = all.",
      },
      disabled: { type: "boolean" },
      disabledReason: { type: "string", enum: ["manual", "auto"] },
      headers: { type: "object", additionalProperties: { type: "string" } },
      secrets: { type: "array", items: { $ref: "#/components/schemas/EndpointSecret" } },
      metadata: {},
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      firstFailingAt: { type: "string", format: "date-time", nullable: true },
    },
  },
  Message: {
    type: "object",
    required: ["id", "eventType", "payload", "timestamp", "createdAt"],
    properties: {
      id: { type: "string", description: "Sent as the webhook-id header." },
      eventType: { type: "string" },
      payload: {},
      timestamp: { type: "string", format: "date-time" },
      idempotencyKey: { type: "string" },
      envelope: { type: "string", description: "The serialized wire envelope." },
      createdAt: { type: "string", format: "date-time" },
    },
  },
  Delivery: {
    type: "object",
    required: ["id", "applicationKey", "messageId", "endpointId", "status", "attemptCount"],
    properties: {
      id: { type: "string" },
      applicationKey: { type: "string" },
      messageId: { type: "string" },
      endpointId: { type: "string" },
      status: { type: "string", enum: ["pending", "delivering", "succeeded", "failed"] },
      attemptCount: { type: "integer" },
      nextAttemptAt: { type: "string", format: "date-time", nullable: true },
      leaseUntil: { type: "string", format: "date-time", nullable: true },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
  },
  DeliveryAttempt: {
    type: "object",
    required: ["id", "deliveryId", "attemptNumber", "at", "durationMs", "ok", "trigger"],
    properties: {
      id: { type: "string" },
      deliveryId: { type: "string" },
      attemptNumber: { type: "integer" },
      at: { type: "string", format: "date-time" },
      durationMs: { type: "number" },
      ok: { type: "boolean" },
      httpStatus: { type: "integer" },
      error: { type: "string" },
      responseBody: { type: "string" },
      trigger: { type: "string", enum: ["schedule", "manual", "test"] },
    },
  },
  PublishResult: {
    type: "object",
    required: ["message", "deliveries", "deduplicated"],
    properties: {
      message: { $ref: "#/components/schemas/Message" },
      deliveries: { type: "array", items: { $ref: "#/components/schemas/Delivery" } },
      deduplicated: {
        type: "boolean",
        description: "True when the idempotency key matched an existing message.",
      },
    },
  },
  RecoverResult: {
    type: "object",
    required: ["deliveryIds"],
    properties: { deliveryIds: { type: "array", items: { type: "string" } } },
  },
  AuditEntry: {
    type: "object",
    required: ["action", "at"],
    properties: {
      action: { type: "string" },
      at: { type: "string", format: "date-time" },
      by: { type: "object", nullable: true },
      applicationKey: { type: "string" },
      subjectId: { type: "string" },
      message: { type: "string" },
    },
  },
  Config: {
    type: "object",
    properties: {
      title: { type: "string" },
      basePath: { type: "string" },
      readonly: { type: "boolean" },
      authenticated: { type: "boolean" },
      principal: { type: "object", nullable: true },
      portal: {
        type: "boolean",
        description: "True when the request carried a valid portal token.",
      },
      logoUrl: { type: "string" },
    },
  },
  Error: {
    type: "object",
    required: ["error"],
    properties: {
      error: { type: "string" },
      code: { type: "string" },
      errors: { type: "array", items: { type: "object" } },
    },
  },
} as const;

const APP = { name: "app", in: "path", required: true, schema: { type: "string" } } as const;
const ID = { name: "id", in: "path", required: true, schema: { type: "string" } } as const;

const jsonBody = (schema: object, required = true) => ({
  required,
  content: { "application/json": { schema } },
});
const jsonRes = (desc: string, schema: object) => ({
  description: desc,
  content: { "application/json": { schema } },
});
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const errorRes = (desc: string) => jsonRes(desc, ref("Error"));
const okRef = (name: string, desc = name) => jsonRes(desc, ref(name));
const arrayOf = (name: string) => ({ type: "array", items: ref(name) });

/** Build the OpenAPI 3.1 document for the admin API. Pure — safe to call anywhere. */
export function buildOpenApiDocument(options: OpenApiOptions = {}): Record<string, unknown> {
  const base = options.basePath && options.basePath !== "/" ? options.basePath : "";
  const endpointPath = "/api/applications/{app}/endpoints/{id}";

  return {
    openapi: "3.1.0",
    info: {
      title: options.title ?? "@xtandard/webhooks Admin API",
      version: options.version ?? "0.1.0",
      description:
        "Admin/control-plane API for @xtandard/webhooks: applications, the global event-type catalog, endpoints (with Standard Webhooks signing secrets), message publishing, and delivery observability. Portal tokens (Authorization: Bearer whpt_…) hit the same surface scoped to one application.",
    },
    servers: [{ url: base || "/" }],
    tags: [
      { name: "meta" },
      { name: "applications" },
      { name: "event-types" },
      { name: "endpoints" },
      { name: "messages" },
      { name: "deliveries" },
      { name: "audit" },
    ],
    security: [{ basicAuth: [] }, { bearerAuth: [] }],
    paths: {
      "/config": {
        get: {
          tags: ["meta"],
          security: [],
          summary: "Bootstrap config (title, basePath, readonly, auth state, portal flag)",
          responses: { "200": okRef("Config") },
        },
      },
      "/api/openapi.json": {
        get: {
          tags: ["meta"],
          security: [],
          summary: "This OpenAPI document",
          responses: { "200": jsonRes("OpenAPI 3.1 document", { type: "object" }) },
        },
      },
      "/api/event-types.json": {
        get: {
          tags: ["meta"],
          security: [],
          summary: "Public event-type catalog (unauthenticated, CORS-open)",
          responses: { "200": jsonRes("Event types", arrayOf("EventType")) },
        },
      },
      "/api/applications": {
        get: {
          tags: ["applications"],
          summary: "List applications",
          responses: { "200": jsonRes("Applications", arrayOf("Application")) },
        },
        post: {
          tags: ["applications"],
          summary: "Create an application",
          requestBody: jsonBody(ref("Application")),
          responses: {
            "201": okRef("Application", "Created"),
            "409": errorRes("Key already exists"),
            "422": errorRes("Validation error"),
          },
        },
      },
      "/api/applications/{app}": {
        parameters: [APP],
        get: {
          tags: ["applications"],
          summary: "Get an application",
          responses: { "200": okRef("Application"), "404": errorRes("Not found") },
        },
        put: {
          tags: ["applications"],
          summary: "Update an application",
          requestBody: jsonBody({
            type: "object",
            properties: { name: { type: "string" }, metadata: {} },
          }),
          responses: { "200": okRef("Application", "Updated"), "404": errorRes("Not found") },
        },
        delete: {
          tags: ["applications"],
          summary: "Delete an application and everything under it",
          responses: {
            "200": jsonRes("Deleted", { type: "object" }),
            "404": errorRes("Not found"),
          },
        },
      },
      "/api/event-types": {
        get: {
          tags: ["event-types"],
          summary: "List event types",
          responses: { "200": jsonRes("Event types", arrayOf("EventType")) },
        },
        post: {
          tags: ["event-types"],
          summary: "Create (upsert) an event type",
          requestBody: jsonBody(ref("EventType")),
          responses: {
            "201": okRef("EventType", "Created"),
            "422": errorRes("Validation error"),
          },
        },
      },
      "/api/event-types/{name}": {
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
        get: {
          tags: ["event-types"],
          summary: "Get an event type",
          responses: { "200": okRef("EventType"), "404": errorRes("Not found") },
        },
        put: {
          tags: ["event-types"],
          summary: "Update an event type",
          requestBody: jsonBody(ref("EventType")),
          responses: { "200": okRef("EventType", "Updated"), "422": errorRes("Validation error") },
        },
        delete: {
          tags: ["event-types"],
          summary: "Delete an event type (endpoints referencing it stop matching)",
          responses: {
            "200": jsonRes("Deleted", { type: "object" }),
            "404": errorRes("Not found"),
          },
        },
      },
      "/api/applications/{app}/endpoints": {
        parameters: [APP],
        get: {
          tags: ["endpoints"],
          summary: "List endpoints (secrets stripped)",
          responses: { "200": jsonRes("Endpoints", arrayOf("Endpoint")) },
        },
        post: {
          tags: ["endpoints"],
          summary: "Create an endpoint — the response includes the signing secret ONCE",
          requestBody: jsonBody({
            type: "object",
            required: ["url"],
            properties: {
              url: { type: "string" },
              description: { type: "string" },
              eventTypes: { type: "array", items: { type: "string" } },
              headers: { type: "object", additionalProperties: { type: "string" } },
              metadata: {},
              disabled: { type: "boolean" },
            },
          }),
          responses: {
            "201": okRef("Endpoint", "Created (includes secrets)"),
            "422": errorRes("Validation error"),
          },
        },
      },
      [endpointPath]: {
        parameters: [APP, ID],
        get: {
          tags: ["endpoints"],
          summary: "Get an endpoint (secrets stripped)",
          responses: { "200": okRef("Endpoint"), "404": errorRes("Not found") },
        },
        put: {
          tags: ["endpoints"],
          summary: "Update an endpoint",
          requestBody: jsonBody({
            type: "object",
            properties: {
              url: { type: "string" },
              description: { type: "string" },
              eventTypes: { type: "array", items: { type: "string" } },
              headers: { type: "object", additionalProperties: { type: "string" } },
              metadata: {},
            },
          }),
          responses: {
            "200": okRef("Endpoint", "Updated"),
            "404": errorRes("Not found"),
            "422": errorRes("Validation error"),
          },
        },
        delete: {
          tags: ["endpoints"],
          summary: "Delete an endpoint",
          responses: {
            "200": jsonRes("Deleted", { type: "object" }),
            "404": errorRes("Not found"),
          },
        },
      },
      [`${endpointPath}/secret`]: {
        parameters: [APP, ID],
        get: {
          tags: ["endpoints"],
          summary: "Read the endpoint's signing secrets (current first)",
          responses: {
            "200": jsonRes("Secrets", arrayOf("EndpointSecret")),
            "404": errorRes("Not found"),
          },
        },
      },
      [`${endpointPath}/rotate-secret`]: {
        parameters: [APP, ID],
        post: {
          tags: ["endpoints"],
          summary: "Mint a new secret; the previous one keeps signing through the grace window",
          responses: {
            "200": okRef("Endpoint", "Rotated (includes secrets)"),
            "404": errorRes("Not found"),
          },
        },
      },
      [`${endpointPath}/enable`]: {
        parameters: [APP, ID],
        post: {
          tags: ["endpoints"],
          summary: "Enable a disabled endpoint (delivery resumes)",
          responses: { "200": okRef("Endpoint", "Enabled"), "404": errorRes("Not found") },
        },
      },
      [`${endpointPath}/disable`]: {
        parameters: [APP, ID],
        post: {
          tags: ["endpoints"],
          summary: "Disable an endpoint (pending deliveries are held, not failed)",
          responses: { "200": okRef("Endpoint", "Disabled"), "404": errorRes("Not found") },
        },
      },
      [`${endpointPath}/test`]: {
        parameters: [APP, ID],
        post: {
          tags: ["endpoints"],
          summary: "Fire a one-off signed example delivery (not retained as a message)",
          requestBody: jsonBody({
            type: "object",
            required: ["eventType"],
            properties: { eventType: { type: "string" }, payload: {} },
          }),
          responses: {
            "200": jsonRes("Attempt outcome", { type: "object" }),
            "404": errorRes("Not found"),
          },
        },
      },
      [`${endpointPath}/recover`]: {
        parameters: [APP, ID],
        post: {
          tags: ["deliveries"],
          summary: "Re-queue every failed delivery for this endpoint since a timestamp",
          requestBody: jsonBody({
            type: "object",
            required: ["since"],
            properties: { since: { type: "string", format: "date-time" } },
          }),
          responses: {
            "200": okRef("RecoverResult", "Re-queued delivery ids"),
            "404": errorRes("Not found"),
          },
        },
      },
      "/api/applications/{app}/messages": {
        parameters: [APP],
        get: {
          tags: ["messages"],
          summary: "List messages (newest first)",
          parameters: [
            { name: "eventType", in: "query", required: false, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer" } },
            { name: "before", in: "query", required: false, schema: { type: "string" } },
          ],
          responses: { "200": jsonRes("Messages", arrayOf("Message")) },
        },
        post: {
          tags: ["messages"],
          summary: "Publish a message (fan-out to matching endpoints; the ingest route)",
          description:
            "Honors an `idempotency-key` header OR a body `idempotencyKey` field (the header wins). A deduplicated publish answers 200 with the original message.",
          parameters: [
            { name: "idempotency-key", in: "header", required: false, schema: { type: "string" } },
          ],
          requestBody: jsonBody({
            type: "object",
            required: ["eventType", "payload"],
            properties: {
              eventType: { type: "string" },
              payload: {},
              timestamp: { type: "string", format: "date-time" },
              idempotencyKey: { type: "string" },
            },
          }),
          responses: {
            "200": okRef("PublishResult", "Deduplicated (existing message)"),
            "201": okRef("PublishResult", "Published"),
            "409": errorRes("Idempotency key reused with a different payload"),
            "413": errorRes("Payload too large"),
            "422": errorRes("Validation error"),
          },
        },
      },
      "/api/applications/{app}/messages/{id}": {
        parameters: [APP, ID],
        get: {
          tags: ["messages"],
          summary: "Get a message with its deliveries",
          responses: {
            "200": jsonRes("Message + deliveries", {
              allOf: [ref("Message")],
              properties: { deliveries: arrayOf("Delivery") },
            }),
            "404": errorRes("Not found"),
          },
        },
      },
      "/api/applications/{app}/deliveries": {
        parameters: [APP],
        get: {
          tags: ["deliveries"],
          summary: "List deliveries (newest first)",
          parameters: [
            {
              name: "status",
              in: "query",
              required: false,
              schema: {
                type: "string",
                enum: ["pending", "delivering", "succeeded", "failed"],
              },
            },
            { name: "endpoint", in: "query", required: false, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer" } },
            { name: "before", in: "query", required: false, schema: { type: "string" } },
          ],
          responses: { "200": jsonRes("Deliveries", arrayOf("Delivery")) },
        },
      },
      "/api/applications/{app}/deliveries/{id}": {
        parameters: [APP, ID],
        get: {
          tags: ["deliveries"],
          summary: "Get a delivery with its attempt timeline",
          responses: {
            "200": jsonRes("Delivery + attempts", {
              allOf: [ref("Delivery")],
              properties: { attempts: arrayOf("DeliveryAttempt") },
            }),
            "404": errorRes("Not found"),
          },
        },
      },
      "/api/applications/{app}/deliveries/{id}/retry": {
        parameters: [APP, ID],
        post: {
          tags: ["deliveries"],
          summary: "Re-queue a dead-lettered delivery",
          responses: {
            "200": okRef("Delivery", "Re-queued"),
            "404": errorRes("Not found"),
            "422": errorRes("Delivery is not in the failed state"),
          },
        },
      },
      "/api/applications/{app}/audit": {
        parameters: [APP],
        get: {
          tags: ["audit"],
          summary: "List audit entries (newest first)",
          responses: { "200": jsonRes("Audit", arrayOf("AuditEntry")) },
        },
      },
    },
    components: {
      schemas,
      securitySchemes: {
        basicAuth: { type: "http", scheme: "basic" },
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Portal tokens (whpt_…) or host-issued bearer credentials.",
        },
      },
    },
  };
}
