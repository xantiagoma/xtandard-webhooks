/**
 * `@xtandard/webhooks` — self-hosted, embeddable, Standard Webhooks-compliant
 * outbound-webhooks control plane.
 *
 * Root export surface. Grows as modules land; see the repository README for
 * the full subpath-export map.
 *
 * @module
 */

export * from "./schema.ts";
export {
  SECRET_PREFIX,
  WebhookVerificationError,
  generateSecret,
  sign,
  signatureHeader,
  verify,
  type VerifyInput,
} from "./signing.ts";
export * as keys from "./keys.ts";
export { newId, idPattern, type IdPrefix } from "./id.ts";
export { durationToMs, parseDurationList } from "./duration.ts";
export {
  KEY_REGEX,
  RESERVED_HEADERS,
  ValidationError,
  assertValid,
  validateApplication,
  validateEndpoint,
  validateEndpointUrl,
  validateEventType,
  type UrlPolicyOptions,
  type ValidationIssue,
  type ValidationResult,
} from "./validation.ts";
