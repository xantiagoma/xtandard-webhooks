# Storage

Bring your own backend: the whole system runs on a four-method async KV contract, with optional capabilities feature-detected at runtime.

## The contract

```ts
interface WebhooksStorage {
  getItem<T>(key: string): Promise<T | null>;
  setItem<T>(key: string, value: T): Promise<void>;
  removeItem(key: string): Promise<void>;
  getKeys(prefix: string): Promise<string[]>;
}
```

Optional capabilities (separate interfaces + guards): `watch` (change notifications), `transaction`, `compareAndSwap` (multi-instance claim safety), and the webhooks-specific `deliveryQueue` (`claimDue` — native due-delivery claiming, see ADR 0005).

## Adapters

| Subpath                                           | Factory                                        | Peers            | watch                              | CAS | claimDue       |
| ------------------------------------------------- | ---------------------------------------------- | ---------------- | ---------------------------------- | --- | -------------- |
| `storage/memory`                                  | `createMemoryStorage`                          | —                | ✓                                  | ✓   | ✓              |
| `storage/file`                                    | `createFileStorage`                            | —                | ✓ (fs.watch)                       |     |                |
| `storage/redis`                                   | `createRedisStorage`, `createRedisJSONStorage` | `redis`          | ✓ (keyspace notifications)         |     | ✓ (sorted set) |
| `storage/postgres`                                | `createPostgresStorage`                        | `pg`             | via `withWatch` + `pgListenNotify` |     |                |
| `storage/drizzle`                                 | `createDrizzleStorage`                         | `drizzle-orm`    | via `withWatch`                    |     |                |
| `drizzle/pg` / `drizzle/mysql` / `drizzle/sqlite` | `pgWebhooksTable` etc.                         | `drizzle-orm`    |                                    |     |                |
| `storage/mongodb`                                 | `createMongoStorage`                           | `mongodb`        |                                    |     |                |
| `storage/sqlite`                                  | `createSqliteStorage`                          | — (`bun:sqlite`) |                                    |     |                |
| `storage/libsql`                                  | `createLibsqlStorage`                          | `@libsql/client` |                                    |     |                |
| `storage/unstorage`                               | `createUnstorageStorage`                       | `unstorage`      |                                    |     |                |
| `storage/cloudflare-kv`                           | `createCloudflareKvStorage`                    | — (binding)      |                                    |     |                |

Conventions shared by every adapter (ported from `@xtandard/flags`): factories return `satisfies`-closed literals; `ownsClient = !options.client` — borrowed clients are never closed; optional peers load via lazy memoized dynamic `import()` with an actionable `requirePeer` error; `close()` exists only on owning adapters.

## The key model

Root `whk`, slash-delimited, application-namespaced — see the module doc in `src/keys.ts` for the full layout. The load-bearing entry is the **due index**:

```txt
whk/{app}/due/{13-digit zero-padded millis}~{deliveryId} → { app, deliveryId }
```

Zero-padded milliseconds make lexicographic = chronological on every backend, which is what lets a plain KV act as the dispatcher's work queue. The conformance suite asserts this ordering for every adapter.

## Splitting control and queue

```ts
createWebhooksCore({
  storage: createPostgresStorage({ connectionString: process.env.DATABASE_URL }),
  queueStorage: createRedisStorage({ url: process.env.REDIS_URL }),
});
```

Control data (applications, event types, endpoints, messages, audit) stays in Postgres; deliveries, attempts, and the due index live in Redis, which claims natively and atomically. `queueStorage` defaults to `storage`.

## Choosing claim safety

| Deployment                                                                     | Requirement                                           |
| ------------------------------------------------------------------------------ | ----------------------------------------------------- |
| one process, embedded dispatcher                                               | any adapter                                           |
| several processes, **one** runs the dispatcher (`dispatcher: false` elsewhere) | any adapter                                           |
| several dispatchers                                                            | `claimDue` (redis/memory) or `compareAndSwap` storage |

## Writing your own adapter

Implement the four methods, then run the conformance suite from this repo's `test/storage-contract.ts` (`runStorageContractTests`) against it — it covers round-trips, prefix isolation, due-index ordering, and (opt-in) `claimDue` semantics: exclusive claims, lease-expiry re-exposure, limit, orphan sweeping. Use `withWatch(storage, subscribe)` to bolt change notifications onto any adapter from whatever signal your infra already has (`pgListenNotify` ships for Postgres `LISTEN/NOTIFY`).
