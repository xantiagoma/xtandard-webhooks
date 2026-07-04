/**
 * The KV table shape the Drizzle storage adapter reads/writes, expressed with
 * the **stable, dialect-agnostic** root `drizzle-orm` types (`Table`/`Column`).
 *
 * The `*WebhooksTable` factories annotate their return as this type on purpose:
 * returning the raw inferred `PgTableWithColumns<…>` would (a) freeze the
 * version-specific internal column brand into the emitted `.d.ts` — breaking
 * consumers on a different `drizzle-orm` (e.g. 1.0 beta, whose `Column` shape
 * differs) — and (b) not be nameable across the `schema`/no-`schema` union
 * (TS2883). `DrizzleKvTable` uses only public types and is all the adapter needs.
 *
 * @module
 */

import type { Column, Table } from "drizzle-orm";

/** A table with the fixed `key`/`value` columns the webhooks KV store requires. */
export type DrizzleKvTable = Table & { key: Column; value: Column };
