# @xtandard/webhooks

Self-hosted, embeddable, Standard Webhooks-compliant outbound-webhooks control plane. Bun for
tooling; `bun run check && bun run test` is the gate (`bun run format` before committing).

## Docs Site

`site/` is an Astro Starlight site (own `package.json`/lockfile, not published) deployed by
`.github/workflows/pages.yml` to https://me.xantiagoma.com/xtandard-webhooks/.

- `README.md` and `docs/*.md` stay the source of truth (they render on GitHub/npm).
  `site/scripts/sync.ts` copies them into `site/src/content/docs/` (generated, gitignored); README
  sections become pages per `site/manifest.ts` — so **renaming an H2 in `README.md` that the
  manifest lists, or adding/renaming a file in `docs/`, needs `site/manifest.ts` updated** (sync
  fails loudly otherwise). Relative links between docs are rewritten to site routes.
- Site-only pages (the home page) live in `site/content/`.
- The API reference is generated from `src/` by starlight-typedoc, one module per `exports` entry
  in `package.json` (`entries()` in `site/manifest.ts`). Each entry file (`src/index.ts`,
  `src/core.ts`, `src/entry-*.ts`, …) starts with a `@module <name>` doc comment that names and
  describes its page; `site/scripts/api-overviews.ts` writes `/api/` and `/api/<module>/`.
- `bun run docs:dev` / `docs:build` / `docs:preview`. Astro runs under Bun (`bun --bun astro …`);
  `.mdx` is excluded from `vp fmt` (it mangles MDX). The build fails on any broken internal link.
