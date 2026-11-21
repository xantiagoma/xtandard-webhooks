import { defineEmbedConfig } from "@xtandard/kit/build";

// Library build for the advanced `@xtandard/webhooks/react` component export:
// dist/react.js (ESM) + dist/react.css. React is a peer (external); everything
// else (TanStack Query, the kit UI, styles) is bundled so the components are
// self-contained. The emitted dist/react.css is a full Tailwind build;
// `xtandard-kit scope-embed-css` runs after this build (see the `build:react`
// script) to scope every rule under `.xtandard-webhooks`.
export default defineEmbedConfig({ entry: "src/react.tsx" });
