// The documentation site: Astro Starlight over the repository's Markdown (scripts/sync.ts copies it
// into src/content/docs/ first), a TypeDoc API reference generated from src/ (starlight-typedoc),
// and Mermaid diagrams. site/manifest.ts holds the information architecture and the entry points.
// `bun run build` writes dist/ here; .github/workflows/pages.yml publishes it.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import starlight from "@astrojs/starlight";
import mermaid from "astro-mermaid";
import { defineConfig } from "astro/config";
import starlightLinksValidator from "starlight-links-validator";
import { createStarlightTypeDocPlugin } from "starlight-typedoc";
import { apiOverviews } from "./scripts/api-overviews.ts";
import {
  entries,
  isGroup,
  isPage,
  npmUrl,
  packageName,
  repoRoot,
  repoUrl,
  sidebar,
  siteBase,
  siteOrigin,
  type Item,
} from "./manifest.ts";

type SidebarItem =
  | { slug: string; label?: string }
  | { label: string; link: string }
  | { label: string; collapsed?: boolean; items: SidebarItem[] };

const toSidebar = (items: Item[]): SidebarItem[] =>
  items.map((i) => {
    if (isPage(i)) return i.label ? { slug: i.slug, label: i.label } : { slug: i.slug };
    if (isGroup(i)) return { label: i.label, collapsed: i.collapsed, items: toSidebar(i.items) };
    return { label: i.label, link: i.link };
  });

/**
 * Entry points other entry points re-export from; the API reference documents those symbols
 * there. The root (src/index.ts) re-exports /schema, /core and /signing, and /receiver re-exports
 * from /signing, so those come first and the root owns only what is its own (the dispatcher, the
 * panel handler, hooks, portal tokens…).
 */
const apiOwners = ["src/schema.ts", "src/signing.ts", "src/core.ts", "src/index.ts"];

const typedocPlugin = new URL("./scripts/typedoc-plugin.ts", import.meta.url);

/** Absolute URL of the social card, for og:image / twitter:image. */
const socialImage = `${siteOrigin}${siteBase}/social.png`;

const [apiReference, apiSidebarGroup] = createStarlightTypeDocPlugin();

export default defineConfig({
  site: siteOrigin,
  base: siteBase,
  trailingSlash: "ignore",
  telemetry: false,
  integrations: [
    // Must come before Starlight.
    mermaid({ theme: "neutral", autoTheme: true, enableLog: false }),
    starlight({
      title: packageName,
      description:
        "Self-hosted, embeddable, Standard Webhooks-compliant outbound webhooks: a Svix alternative as a library.",
      // The brand lockups (docs/BRAND.md): ink wordmark on light, paper wordmark on dark.
      logo: {
        light: "../docs/assets/lockup-horizontal-light.svg",
        dark: "../docs/assets/lockup-horizontal-dark.svg",
        alt: packageName,
        replacesTitle: true,
      },
      favicon: "/favicon.svg",
      head: [
        { tag: "link", attrs: { rel: "icon", href: `${siteBase}/favicon.ico`, sizes: "32x32" } },
        {
          tag: "link",
          attrs: { rel: "apple-touch-icon", href: `${siteBase}/apple-touch-icon.png` },
        },
        { tag: "meta", attrs: { name: "theme-color", content: "#0f1215" } },
        // The social card (docs/assets/social.png, copied to public/ by scripts/brand-assets.sh).
        { tag: "meta", attrs: { property: "og:image", content: socialImage } },
        { tag: "meta", attrs: { property: "og:image:width", content: "1280" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "640" } },
        { tag: "meta", attrs: { name: "twitter:card", content: "summary_large_image" } },
        { tag: "meta", attrs: { name: "twitter:image", content: socialImage } },
      ],
      social: [
        { icon: "github", label: "GitHub", href: repoUrl },
        { icon: "npm", label: "npm", href: npmUrl },
      ],
      editLink: { baseUrl: `${repoUrl}/edit/main/` },
      lastUpdated: false,
      customCss: ["./src/styles/brand.css"],
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      sidebar: [
        ...toSidebar(sidebar).slice(0, -1),
        apiSidebarGroup,
        ...toSidebar(sidebar).slice(-1),
      ],
      plugins: [
        apiReference({
          // A fixed order: a symbol exported by several entry points is documented under the first
          // one TypeDoc meets, and a glob's order differs between file systems (macOS vs the Linux
          // CI). The modules that others re-export from come first; then the rest alphabetically.
          entryPoints: [
            ...apiOwners,
            ...entries()
              .map((e) => e.source)
              .filter((f) => !apiOwners.includes(f))
              .sort(),
          ].map((f) => join(repoRoot, f)),
          // Solution-style: one program for every entry point under src/ (against Elysia 1) and
          // one for the Elysia 2 adapter with `elysia` resolved to Elysia 2 (as
          // tsconfig.elysia2.json checks it), so /api/elysia2/ shows Elysia 2's types.
          tsconfig: "./typedoc.tsconfig.json",
          output: "api",
          sidebar: { label: "API reference", collapsed: true },
          typeDoc: {
            // scripts/typedoc-plugin.ts: named return types as written, and the re-export list
            // scripts/api-overviews.ts puts on each module page.
            plugin: ["typedoc-plugin-missing-exports", fileURLToPath(typedocPlugin)],
            // @ts-expect-error -- typedoc-plugin-missing-exports options
            placeInternalsInOwningModule: true,
            excludePrivate: true,
            excludeInternal: true,
            excludeExternals: true,
            disableGit: true,
            // `bun run typecheck` (CI) type-checks the project, tests included. TypeDoc only reads
            // src/, and its own check of the whole program would trip on test-only imports.
            skipErrorChecking: true,
            // {path} is relative to src/ (the entry points' common directory).
            sourceLinkTemplate: `${repoUrl}/blob/main/src/{path}#L{line}`,
            useCodeBlocks: true,
            parametersFormat: "table",
            interfacePropertiesFormat: "table",
            classPropertiesFormat: "table",
            typeDeclarationFormat: "table",
            enumMembersFormat: "table",
          },
        }),
        // After starlight-typedoc (plugins run in order): the /api/ and /api/<module>/ pages.
        apiOverviews(),
        starlightLinksValidator({
          errorOnRelativeLinks: false,
          errorOnInvalidHashes: true,
          // The guides point at the local dev servers they start (http://localhost:3000, :7789).
          errorOnLocalLinks: false,
        }),
      ],
    }),
  ],
});
