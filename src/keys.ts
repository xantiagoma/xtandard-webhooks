/**
 * Storage key layout for `@xtandard/webhooks`.
 *
 * Keys are namespaced by application so a single storage backend can host the
 * whole control plane. Pure string helpers — no dependencies.
 *
 * ```txt
 * whk/applications                                 -> string[] index
 * whk/{app}/metadata                               -> Application
 * whk/event-types                                  -> string[] index (global)
 * whk/event-types/{name}                           -> EventType
 * whk/{app}/endpoints                              -> string[] index
 * whk/{app}/endpoints/{id}                         -> Endpoint
 * whk/{app}/messages/{id}                          -> Message
 * whk/{app}/idempotency/{key}                      -> message id
 * whk/{app}/deliveries/{id}                        -> Delivery
 * whk/{app}/attempts/{deliveryId}/{n}              -> DeliveryAttempt (n zero-padded)
 * whk/{app}/due/{dueAtMillis}~{deliveryId}         -> DueEntry (13-digit zero-padded millis)
 * whk/{app}/by-message/{messageId}/{deliveryId}    -> 1 (reverse index)
 * whk/{app}/by-endpoint/{endpointId}/{deliveryId}  -> 1 (reverse index)
 * whk/{app}/audit-log                              -> AuditEntry[] (single ordered array)
 * ```
 *
 * The due index is the dispatcher's generic work queue: 13-digit zero-padded
 * milliseconds make lexicographic key order chronological, so a sorted
 * `getKeys(duePrefix(app))` scan yields deliveries in due order.
 *
 * @module
 */

/** Root namespace segment for all keys. */
export const ROOT = "whk";

/**
 * Application keys that would collide with global index keys under the shared
 * root. Rejected by validation.
 */
export const RESERVED_APPLICATION_KEYS = ["applications", "event-types", "audit-log"] as const;

/** Global audit log (event-type actions, which are not application-scoped). */
export const globalAuditLogKey = () => `${ROOT}/audit-log`;

/** Index key listing all known application keys. */
export const applicationsKey = () => `${ROOT}/applications`;

/** Metadata for a single application. */
export const applicationMetaKey = (applicationKey: string) => `${ROOT}/${applicationKey}/metadata`;

/** Index key listing all event type names (global catalog). */
export const eventTypesKey = () => `${ROOT}/event-types`;

/** A single event type record. */
export const eventTypeKey = (name: string) => `${ROOT}/event-types/${name}`;

/** Index key listing an application's endpoint ids. */
export const endpointsKey = (applicationKey: string) => `${ROOT}/${applicationKey}/endpoints`;

/** A single endpoint record. */
export const endpointKey = (applicationKey: string, endpointId: string) =>
  `${ROOT}/${applicationKey}/endpoints/${endpointId}`;

/** Prefix under which an application's messages live. */
export const messagesPrefix = (applicationKey: string) => `${ROOT}/${applicationKey}/messages/`;

/** A single message record. */
export const messageKey = (applicationKey: string, messageId: string) =>
  `${messagesPrefix(applicationKey)}${messageId}`;

/** Maps a caller-supplied idempotency key to the message id it produced. */
export const idempotencyKey = (applicationKey: string, key: string) =>
  `${ROOT}/${applicationKey}/idempotency/${key}`;

/** Prefix under which an application's deliveries live. */
export const deliveriesPrefix = (applicationKey: string) => `${ROOT}/${applicationKey}/deliveries/`;

/** A single delivery record. */
export const deliveryKey = (applicationKey: string, deliveryId: string) =>
  `${deliveriesPrefix(applicationKey)}${deliveryId}`;

/** Prefix under which one delivery's attempts live. */
export const attemptsPrefix = (applicationKey: string, deliveryId: string) =>
  `${ROOT}/${applicationKey}/attempts/${deliveryId}/`;

/**
 * A single attempt record. The attempt number is zero-padded to four digits so
 * lexicographic key order equals attempt order.
 */
export const attemptKey = (applicationKey: string, deliveryId: string, attemptNumber: number) =>
  `${attemptsPrefix(applicationKey, deliveryId)}${String(attemptNumber).padStart(4, "0")}`;

/** Prefix of an application's due index (the dispatcher's work queue). */
export const duePrefix = (applicationKey: string) => `${ROOT}/${applicationKey}/due/`;

/** Value stored at a due-index key. */
export interface DueEntry {
  app: string;
  deliveryId: string;
}

/**
 * A due-index entry: 13-digit zero-padded epoch milliseconds, then the delivery
 * id, `~`-separated. Sorting keys lexicographically sorts entries chronologically.
 */
export const dueKey = (applicationKey: string, dueAtMillis: number, deliveryId: string) =>
  `${duePrefix(applicationKey)}${String(dueAtMillis).padStart(13, "0")}~${deliveryId}`;

/** Parse a due-index key back into its due-time and delivery id. */
export const parseDueKey = (key: string): { dueAtMillis: number; deliveryId: string } | null => {
  const last = lastSegment(key);
  const sep = last.indexOf("~");
  if (sep === -1) return null;
  const millis = Number(last.slice(0, sep));
  const deliveryId = last.slice(sep + 1);
  if (!Number.isFinite(millis) || deliveryId.length === 0) return null;
  return { dueAtMillis: millis, deliveryId };
};

/** Prefix of the message → deliveries reverse index. */
export const byMessagePrefix = (applicationKey: string, messageId: string) =>
  `${ROOT}/${applicationKey}/by-message/${messageId}/`;

/** One entry in the message → deliveries reverse index. */
export const byMessageKey = (applicationKey: string, messageId: string, deliveryId: string) =>
  `${byMessagePrefix(applicationKey, messageId)}${deliveryId}`;

/** Prefix of the endpoint → deliveries reverse index. */
export const byEndpointPrefix = (applicationKey: string, endpointId: string) =>
  `${ROOT}/${applicationKey}/by-endpoint/${endpointId}/`;

/** One entry in the endpoint → deliveries reverse index. */
export const byEndpointKey = (applicationKey: string, endpointId: string, deliveryId: string) =>
  `${byEndpointPrefix(applicationKey, endpointId)}${deliveryId}`;

/** Append-only audit log for an application, stored as an ordered `AuditEntry[]`. */
export const auditLogKey = (applicationKey: string) => `${ROOT}/${applicationKey}/audit-log`;

/** Prefix under which everything belonging to one application lives. */
export const applicationPrefix = (applicationKey: string) => `${ROOT}/${applicationKey}/`;

/** Extract the trailing segment (endpoint id / message id / …) from a key. */
export const lastSegment = (key: string): string => {
  const parts = key.split("/");
  return parts[parts.length - 1] ?? "";
};
