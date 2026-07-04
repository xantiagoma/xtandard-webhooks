# Releases

ZeroVer (`0.x`): the API is stabilizing; minor bumps may break, patch bumps don't. Releases are cut manually — the proven flow below, **not** `changelogen --release` (its auto-tag once tagged a pre-bump commit in the sibling flags repo).

## The flow

```sh
export NODE_OPTIONS=            # a stale preload breaks husky under node

# 1. Preview the changelog since the last tag
bunx changelogen --from vPREV --to HEAD

# 2. Bump + record
npm pkg set version=X.Y.Z      # also bump VERSION in src/version.ts
#    prepend the CHANGELOG.md entry from the preview
bun run format                  # ALWAYS before committing, even docs-only
git add -A && git commit -m "chore(release): vX.Y.Z"

# 3. Tag and push — main FIRST, tag second
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin main
git push origin vX.Y.Z

# 4. Verify the tag dereferences to the release commit
git ls-remote origin 'refs/tags/vX.Y.Z^{}'

# 5. Watch the Release workflow (build → publint → npm publish --provenance → GitHub Release)
gh run watch

# 6. Confirm
npm view @xtandard/webhooks version
```

Requirements: the `NPM_TOKEN` repo secret (npm automation token with publish rights to `@xtandard`), and `.npmrc` keeps `provenance=true`.

## Conventional commits

Scopes: `core`, `dispatcher`, `signing`, `storage`, `server`, `ui`, `react`, `portal`, `cli`, `examples`, `docs`, `ci`. The changelog is generated from these — write them for the reader.
