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
export * from "./core.ts";
export {
  createDispatcher,
  DEFAULT_RETRY_SCHEDULE,
  type Dispatcher,
  type DispatcherOptions,
} from "./dispatcher.ts";
export {
  activeSecrets,
  attemptDelivery,
  DEFAULT_ATTEMPT_TIMEOUT_MS,
  DEFAULT_RESPONSE_BODY_LIMIT,
  type AttemptDeliveryInput,
  type AttemptOutcome,
} from "./deliver.ts";
export {
  emitDelivery,
  type DeliveryErrorReporter,
  type DeliveryEvent,
  type DeliveryListener,
} from "./delivery-sink.ts";
export {
  HookDeniedError,
  defaultHookErrorReporter,
  normalizeHooks,
  runAfter,
  runBefore,
  type AfterEvent,
  type AfterEventType,
  type BeforeEvent,
  type BeforeEventType,
  type HookErrorReporter,
  type WebhooksHooks,
  type WebhooksHooksInput,
} from "./hooks/contract.ts";
export { VERSION } from "./version.ts";
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
  hasDeliveryQueue,
  isCompareAndSwap,
  isTransactional,
  isWatchable,
  requirePeer,
  type CompareAndSwapWebhooksStorage,
  type DeliveryQueueStorage,
  type StorageChangeEvent,
  type TransactionalWebhooksStorage,
  type WatchableWebhooksStorage,
  type WebhooksStorage,
} from "./storage/contract.ts";
export {
  pgListenNotify,
  withWatch,
  type PgNotificationClient,
  type WatchSubscribe,
} from "./storage/watch.ts";
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
