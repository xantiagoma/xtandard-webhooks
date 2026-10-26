/**
 * Post-build step for the `@xtandard/webhooks/elysia2` declarations.
 *
 * `tsc -p tsconfig.elysia2.build.json` type-checks against the `elysia-v2`
 * devDep alias (the repo itself develops on Elysia 1), and where tsc has to name
 * an inferred type it may spell the alias: `import("elysia-v2/types")`. Consumers
 * install Elysia 2 as plain `elysia`, so rewrite the specifier.
 *
 * Run: `bun scripts/fix-elysia2-types.ts` (chained in the `build:elysia2-types` script).
 *
 * @module
 */

import { Glob } from "bun";

const dir = "dist/types-elysia2";
let rewritten = 0;

for await (const path of new Glob("**/*.d.ts").scan(dir)) {
  const file = Bun.file(`${dir}/${path}`);
  const src = await file.text();
  const out = src.replace(/(["'])elysia-v2(\/[^"']*)?\1/g, "$1elysia$2$1");
  if (out !== src) {
    await Bun.write(file, out);
    rewritten++;
  }
}

console.log(`fix-elysia2-types: rewrote elysia-v2 → elysia in ${rewritten} file(s)`);
