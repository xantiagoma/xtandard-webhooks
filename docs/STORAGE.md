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

Optional capabilities (separate interfaces + guards): `watch` (change notifications), `compareAndSwap` (multi-instance claim safety), and the webhooks-specific `deliveryQueue` (`claimDue` — native due-delivery claiming, see ADR 0005). `transaction` / `isTransactional` are still exported but deprecated: no driver implements them.

The contract, the drivers and their conformance suite are [`@xtandard/kit`](https://me.xantiagoma.com/xtandard-kit/)'s, shared by every xtandard product; this package passes its persisted defaults (the `xtandard_webhooks` table, the `xtandard_webhooks` / `webhooks_kv` Mongo names, the `xtandard_webhooks` pg channel) and adds `claimDue`.

## Adapters

| Subpath                                           | Factory                                        | Peers            | watch                              | CAS | claimDue       |
| ------------------------------------------------- | ---------------------------------------------- | ---------------- | ---------------------------------- | --- | -------------- |
| `storage/memory`                                  | `createMemoryStorage`                          | —                | ✓                                  | ✓   | ✓              |
| `storage/file`                                    | `createFileStorage`                            | —                | ✓ (fs.watch)                       | ✓   |                |
| `storage/redis`                                   | `createRedisStorage`, `createRedisJSONStorage` | `redis`          | ✓ (keyspace notifications)         | ✓   | ✓ (sorted set) |
| `storage/postgres`                                | `createPostgresStorage`                        | `pg`             | via `withWatch` + `pgListenNotify` | ✓   |                |
| `storage/drizzle`                                 | `createDrizzleStorage`                         | `drizzle-orm`    | via `withWatch`                    | ✓   |                |
| `drizzle/pg` / `drizzle/mysql` / `drizzle/sqlite` | `pgWebhooksTable` etc.                         | `drizzle-orm`    |                                    |     |                |
| `storage/mongodb`                                 | `createMongoStorage`                           | `mongodb`        |                                    | ✓   |                |
| `storage/sqlite`                                  | `createSqliteStorage`                          | — (`bun:sqlite`) |                                    | ✓   |                |
| `storage/libsql`                                  | `createLibsqlStorage`                          | `@libsql/client` |                                    | ✓   |                |
| `storage/unstorage`                               | `createUnstorageStorage`                       | `unstorage`      |                                    |     |                |
| `storage/cloudflare-kv`                           | `createCloudflareKvStorage`                    | — (binding)      |                                    |     |                |

Conventions shared by every adapter: `ownsClient = !options.client` — borrowed clients are never closed; optional peers load lazily on first use with an actionable error that names the package to install; `close()` exists only on owning adapters; `getKeys` re-checks every key with an exact `startsWith`. Values are written as canonical JSON (sorted keys); rows written by earlier releases read, list and swap as before.

### File storage: case-safe file names

Keys are case-sensitive, but the default filesystems on macOS and Windows are not. `storage/file` therefore encodes each key segment into a reversible, case-safe file name: an uppercase letter becomes `^` + the letter (`Acme` → `^acme`), `^` becomes `^^`, and anything outside `[a-z0-9._~!@,=+_-]` becomes `%XX`. Stores written by v0.1.4 or earlier used raw segments. Migrate them once, with no writer running:

```ts
import { migrateFileStorage } from "@xtandard/webhooks/storage/file";

await migrateFileStorage({ dir: "./data/webhooks" }); // → { moved: n }; idempotent
```

Until you migrate, files in the old layout are ignored, and `getKeys` logs a warning once. Keys that the old layout had already merged on a case-insensitive filesystem stay merged.

### MySQL (Drizzle): a case-sensitive key column

Keys are case-sensitive: `whk/Acme/…` and `whk/acme/…` are different applications. MySQL's default collation (`utf8mb4_0900_ai_ci`) is case- and accent-insensitive, so `mysqlWebhooksTable()` declares the `key` column with `utf8mb4_bin`. If your table was created from an earlier version (any release up to and including v0.1.4), re-collate the column:

```sql
ALTER TABLE xtandard_webhooks
  MODIFY `key` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;
```

Use your table name and `keyLength` (default `512`). The old primary key never held two keys that differ only by case or accent, so the `ALTER` cannot fail on duplicates. It does not split data that was already merged: writes for both spellings went to one row (under the first spelling written), and only applications whose keys differ by case alone were affected.

### MySQL (Drizzle): trailing spaces

`utf8mb4_bin` is a PAD SPACE collation: it ignores trailing spaces, so `whk/acme ` and `whk/acme` are one primary key. The driver matches keys byte-exactly on reads, removes and swaps, and a write whose key differs from a stored key only by trailing spaces throws `KeyCollisionError` instead of overwriting it. The admin API never lets such a key through (every path parameter must match `KEY_REGEX`). New tables can opt into a NO PAD collation, `mysqlWebhooksTable(name, { keyCollation: "utf8mb4_0900_bin" })` (MySQL 8.0+; `utf8mb4_nopad_bin` on MariaDB), and existing ones can migrate in place:

```sql
ALTER TABLE xtandard_webhooks
  MODIFY `key` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL;
```

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
