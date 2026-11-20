/**
 * Postgres storage: `createPostgresStorage()` keeps a single `jsonb` key/value
 * table, created on first use. Works with `pg` or PGlite.
 *
 * Import from `@xtandard/webhooks/storage/postgres`.
 *
 * @module storage/postgres
 */

export * from "./storage/postgres.ts";
