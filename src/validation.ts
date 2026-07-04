/**
 * Runtime validation for control-plane inputs, built on `valibot`.
 *
 * This is the **admin path** only — `publish()` performs its own minimal
 * checks and the wire/receiver path never imports this module, so `valibot`
 * stays off the hot paths. Validation combines structural parsing (valibot)
 * with semantic checks (URL policy, reserved header names, reserved keys).
 *
 * @module
 */

import * as v from "valibot";
import { RESERVED_APPLICATION_KEYS } from "./keys.ts";
import type { Application, Endpoint } from "./schema.ts";

/** Allowed characters for application keys and event type names. */
export const KEY_REGEX = /^[a-zA-Z0-9._-]+$/;

/**
 * Header names owned by the Standard Webhooks wire contract. Endpoints may not
 * override them via static headers.
 */
export const RESERVED_HEADERS = ["webhook-id", "webhook-timestamp", "webhook-signature"] as const;

const jsonValueSchema: v.GenericSchema<unknown> = v.lazy(() =>
  v.union([
    v.string(),
    v.number(),
    v.boolean(),
    v.null(),
    v.array(jsonValueSchema),
    v.record(v.string(), jsonValueSchema),
  ]),
);

const keySchema = v.pipe(v.string(), v.minLength(1), v.maxLength(256), v.regex(KEY_REGEX));

const applicationSchema = v.object({
  key: keySchema,
  name: v.optional(v.string()),
  metadata: v.optional(jsonValueSchema),
  createdAt: v.optional(v.string()),
  updatedAt: v.optional(v.string()),
});

const eventTypeSchema = v.object({
  name: keySchema,
  description: v.optional(v.string()),
  groupName: v.optional(v.string()),
  schema: v.optional(jsonValueSchema),
  deprecated: v.optional(v.boolean()),
  createdAt: v.optional(v.string()),
  updatedAt: v.optional(v.string()),
});

const endpointSecretSchema = v.object({
  secret: v.pipe(v.string(), v.minLength(1)),
  createdAt: v.string(),
  expiresAt: v.optional(v.string()),
});

const endpointSchema = v.object({
  id: v.optional(v.string()),
  url: v.pipe(v.string(), v.minLength(1)),
  description: v.optional(v.string()),
  eventTypes: v.optional(v.array(keySchema)),
  disabled: v.optional(v.boolean()),
  disabledReason: v.optional(v.picklist(["manual", "auto"])),
  headers: v.optional(v.record(v.string(), v.string())),
  secrets: v.optional(v.array(endpointSecretSchema)),
  metadata: v.optional(jsonValueSchema),
  createdAt: v.optional(v.string()),
  updatedAt: v.optional(v.string()),
  firstFailingAt: v.optional(v.nullable(v.string())),
});

/** A single validation problem with a dotted path into the offending data. */
export interface ValidationIssue {
  path: string;
  message: string;
}

/** Result of the `validate*` functions. */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
}

/** Raised by {@link assertValid} when an input fails validation. Maps to HTTP 422. */
export class ValidationError extends Error {
  readonly errors: ValidationIssue[];
  constructor(errors: ValidationIssue[]) {
    super(`Validation failed:\n${errors.map((e) => `  - ${e.path}: ${e.message}`).join("\n")}`);
    this.name = "ValidationError";
    this.errors = errors;
  }
}

/** Throw a {@link ValidationError} when `result` is invalid. */
export function assertValid(result: ValidationResult): void {
  if (!result.valid) throw new ValidationError(result.errors);
}

function structuralIssues(
  issues: readonly v.BaseIssue<unknown>[],
  basePath: string,
): ValidationIssue[] {
  return issues.map((issue) => ({
    path: `${basePath}.${(issue.path ?? []).map((p) => String(p.key)).join(".")}`,
    message: issue.message,
  }));
}

/**
 * Validate an {@link Application}: structure + reserved-key check.
 *
 * @example
 * ```ts
 * import { validateApplication } from "@xtandard/webhooks";
 *
 * const result = validateApplication({ key: "acme" });
 * // result.valid === true
 * ```
 */
export function validateApplication(input: unknown, basePath = "application"): ValidationResult {
  const parsed = v.safeParse(applicationSchema, input);
  if (!parsed.success) {
    return { valid: false, errors: structuralIssues(parsed.issues, basePath) };
  }
  const application = parsed.output as Application;
  const errors: ValidationIssue[] = [];
  if ((RESERVED_APPLICATION_KEYS as readonly string[]).includes(application.key)) {
    errors.push({
      path: `${basePath}.key`,
      message: `"${application.key}" is a reserved application key`,
    });
  }
  return { valid: errors.length === 0, errors };
}

/** Validate an {@link EventType}: structural only (the name regex carries the semantics). */
export function validateEventType(input: unknown, basePath = "eventType"): ValidationResult {
  const parsed = v.safeParse(eventTypeSchema, input);
  if (!parsed.success) {
    return { valid: false, errors: structuralIssues(parsed.issues, basePath) };
  }
  return { valid: true, errors: [] };
}

/** Options that relax/extend the endpoint URL policy. */
export interface UrlPolicyOptions {
  /** Allow `http:` for non-localhost hosts (dev only; default `false`). */
  allowInsecureUrls?: boolean;
  /** Extra host-supplied gate; return `false` to reject (e.g. an SSRF denylist). */
  urlPolicy?: (url: string) => boolean;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Validate an endpoint destination URL: parseable, `https:` (or `http:` for
 * localhost, or anywhere when `allowInsecureUrls`), no embedded credentials,
 * and passing the host's optional `urlPolicy` gate.
 */
export function validateEndpointUrl(
  url: string,
  options: UrlPolicyOptions = {},
  basePath = "endpoint.url",
): ValidationResult {
  const errors: ValidationIssue[] = [];
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, errors: [{ path: basePath, message: `invalid URL "${url}"` }] };
  }
  if (parsed.username || parsed.password) {
    errors.push({ path: basePath, message: "URL must not contain credentials" });
  }
  if (parsed.protocol === "http:") {
    if (!options.allowInsecureUrls && !LOCAL_HOSTS.has(parsed.hostname)) {
      errors.push({
        path: basePath,
        message: "http URLs are only allowed for localhost (set allowInsecureUrls for dev)",
      });
    }
  } else if (parsed.protocol !== "https:") {
    errors.push({ path: basePath, message: `unsupported protocol "${parsed.protocol}"` });
  }
  if (errors.length === 0 && options.urlPolicy && !options.urlPolicy(url)) {
    errors.push({ path: basePath, message: "URL rejected by the configured urlPolicy" });
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Validate an {@link Endpoint} input: structure, URL policy, and static-header
 * restrictions (the Standard Webhooks headers are reserved).
 *
 * @example
 * ```ts
 * import { validateEndpoint } from "@xtandard/webhooks";
 *
 * const result = validateEndpoint({ url: "https://api.example.com/hooks" });
 * // result.valid === true
 * ```
 */
export function validateEndpoint(
  input: unknown,
  options: UrlPolicyOptions = {},
  basePath = "endpoint",
): ValidationResult {
  const parsed = v.safeParse(endpointSchema, input);
  if (!parsed.success) {
    return { valid: false, errors: structuralIssues(parsed.issues, basePath) };
  }
  const endpoint = parsed.output as unknown as Endpoint;
  const errors: ValidationIssue[] = [];
  errors.push(...validateEndpointUrl(endpoint.url, options, `${basePath}.url`).errors);
  for (const name of Object.keys(endpoint.headers ?? {})) {
    if ((RESERVED_HEADERS as readonly string[]).includes(name.toLowerCase())) {
      errors.push({
        path: `${basePath}.headers.${name}`,
        message: `"${name}" is reserved by the Standard Webhooks wire contract`,
      });
    }
  }
  return { valid: errors.length === 0, errors };
}
