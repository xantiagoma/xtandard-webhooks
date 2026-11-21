import { defineConfig } from "vite-plus";
import { defineXtandardConfig } from "@xtandard/kit/build";

// The family skeleton (core + elysia2 test projects, retry, v8 coverage, lint/fmt
// ignores, the staged formatter, ESM + CJS pack with bun:* never bundled) is the
// kit's; webhooks passes its entries and its own coverage bar.
export default defineConfig(
  defineXtandardConfig({
    entries: [
      "src/index.ts",
      "src/core.ts",
      "src/schema.ts",
      "src/signing.ts",
      "src/receiver.ts",
      "src/testing.ts",
      "src/entry-storage-memory.ts",
      "src/entry-storage-file.ts",
      "src/entry-storage-redis.ts",
      "src/entry-storage-postgres.ts",
      "src/entry-storage-drizzle.ts",
      "src/entry-storage-mongodb.ts",
      "src/entry-storage-sqlite.ts",
      "src/entry-storage-libsql.ts",
      "src/entry-storage-unstorage.ts",
      "src/entry-storage-cloudflare-kv.ts",
      "src/entry-drizzle-pg.ts",
      "src/entry-drizzle-mysql.ts",
      "src/entry-drizzle-sqlite.ts",
      "src/entry-auth-none.ts",
      "src/entry-auth-basic.ts",
      "src/entry-auth-delegated.ts",
      "src/entry-authorization-none.ts",
      "src/entry-authorization-roles.ts",
      "src/entry-authorization-delegated.ts",
      "src/entry-hooks-log.ts",
      "src/entry-bun.ts",
      "src/entry-elysia.ts",
      // Types come from tsconfig.elysia2.build.json (built against Elysia 2), not here.
      "src/entry-elysia2.ts",
      "src/entry-express.ts",
      "src/entry-hono.ts",
      "src/cli.ts",
    ],
    coverage: {
      thresholds: { statements: 92, branches: 85, functions: 90, lines: 92 },
      // Bun-only drivers, exercised by the bun:test suites.
      exclude: ["src/storage/sqlite.ts", "src/storage/libsql.ts"],
    },
  }),
);
