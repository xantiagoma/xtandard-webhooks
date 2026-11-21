// The site's information architecture: which repository Markdown becomes which page, the sidebar
// tree, and the package's entry points. scripts/sync.ts reads it to write src/content/docs/, and
// astro.config.ts reads it to build the sidebar and the API reference, so a page and its sidebar
// entry cannot drift.
//
// The Markdown in the repository (README.md, docs/*.md) stays the single source of truth: it is
// what GitHub and npm render. A page is one of:
//   - a whole repository file (`src`);
//   - some H2 sections of one (`src` + `sections`, optionally `intro` for the text above the first
//     H2) — how README.md is split into several pages. Every H2 of a split file other than the
//     README must land on exactly one page, so a new section cannot silently disappear;
//   - a page written for the site only (`site`, relative to site/content/).
// Plain Node APIs only: Astro loads this file through Vite.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("../", import.meta.url));
export const repoSlug = "xantiagoma/xtandard-webhooks";
export const repoUrl = `https://github.com/${repoSlug}`;
export const packageName = "@xtandard/webhooks";
export const npmUrl = "https://www.npmjs.com/package/@xtandard/webhooks";
export const branch = "main";
/**
 * Where the site is served: the project site of xantiagoma.github.io, under the account's custom
 * domain. pages.yml passes what actions/configure-pages reports (SITE_ORIGIN, SITE_BASE), so a
 * domain change needs no code change. configure-pages reports the custom domain as `http://` even
 * though Pages serves it over HTTPS, so the origin (og:url, og:image, sitemap) is upgraded to https.
 */
export const siteOrigin = (process.env.SITE_ORIGIN || "https://me.xantiagoma.com").replace(
  /^http:\/\//,
  "https://",
);
export const siteBase = (process.env.SITE_BASE || "/xtandard-webhooks").replace(/\/+$/, "");

// ---- entry points ---------------------------------------------------------------------------

export type Entry = {
  /** The API reference module name (the `@module` tag of the entry file) and its route. */
  module: string;
  /** The import specifier users write. */
  importPath: string;
  /** The source file, relative to the repository root. */
  source: string;
};

/** The root import's module name: `@xtandard/webhooks` is documented at /api/webhooks/. */
export const rootModule = "webhooks";

/** Subpaths that are not TypeScript entry points (assets, the manifest). */
const nonCode = (key: string) =>
  key === "./package.json" || key.endsWith(".css") || key.includes("*");

/**
 * Every public entry point, in package.json `exports` order. The source file follows the build's
 * convention (vite.config.ts `pack.entry`): the root is src/index.ts, a few subpaths have their
 * own module (src/core.ts, src/react.tsx…), and the rest are src/entry-<path-with-dashes>.ts.
 */
export function entries(): Entry[] {
  const exportsMap = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))
    .exports as Record<string, unknown>;
  return Object.keys(exportsMap)
    .filter((key) => !nonCode(key))
    .map((key) => {
      const sub = key.replace(/^\.\/?/, "");
      const entryFile = `src/entry-${sub.replaceAll("/", "-")}.ts`;
      const candidates =
        sub === ""
          ? ["src/index.ts"]
          : sub.includes("/")
            ? [entryFile]
            : [`src/${sub}.ts`, `src/${sub}.tsx`, entryFile];
      const source = candidates.find((f) => existsSync(join(repoRoot, f)));
      if (!source) throw new Error(`manifest.ts: no source entry for "${key}" in package.json`);
      return {
        module: sub === "" ? rootModule : sub,
        importPath: sub === "" ? packageName : `${packageName}/${sub}`,
        source,
      };
    });
}

// ---- pages ----------------------------------------------------------------------------------

export type Page = {
  /** Route without the base and without slashes; "" is the home page. */
  slug: string;
  /** Sidebar label; the page title when absent. */
  label?: string;
  /** Repository file the page is built from. */
  src?: string;
  /** Only these H2 sections of `src` (by heading text, in file order). */
  sections?: string[];
  /** With `sections`: also the H1 and the text above the first H2. */
  intro?: boolean;
  /** Page title when it does not come from the source's H1. */
  title?: string;
  /** Site-only page in site/content/ (.md or .mdx). */
  site?: string;
  /** Contributor-only material: a banner says so and search skips it. */
  internal?: boolean;
};
export type Link = { label: string; link: string };
export type Group = { label: string; collapsed?: boolean; items: Item[] };
export type Item = Page | Link | Group;

export const home: Page = { slug: "", site: "index.mdx" };

const adrs: [file: string, label: string][] = [
  ["0001-single-package-subpath-exports.md", "0001 · Subpath exports"],
  ["0002-delivery-plane-independence.md", "0002 · Delivery-plane independence"],
  ["0003-bundled-spa-ui.md", "0003 · Bundled SPA UI"],
  ["0004-standard-webhooks-compliance.md", "0004 · Standard Webhooks"],
  ["0005-storage-kv-contract-due-index.md", "0005 · Storage contract"],
  ["0006-portal-tokens.md", "0006 · Portal tokens"],
  ["0007-retry-schedule-auto-disable.md", "0007 · Retries & auto-disable"],
  ["0008-webhook-id-is-message-id.md", "0008 · webhook-id is the message id"],
];

export const sidebar: Item[] = [
  {
    label: "Start here",
    items: [
      { slug: "getting-started", src: "docs/GETTING_STARTED.md", label: "Getting started" },
      {
        slug: "guides/why",
        src: "README.md",
        sections: ["Why another webhooks tool?", "How it works — the two planes"],
        title: "Why @xtandard/webhooks",
        label: "Why & how it works",
      },
      {
        slug: "guides/quickstart",
        src: "README.md",
        sections: ["Quickstart", "Send your first webhook", "Verify on the receiving side"],
        title: "Quickstart: mount, publish, verify",
        label: "Quickstart",
      },
      {
        slug: "guides/subpath-exports",
        src: "README.md",
        sections: ["Subpath exports"],
        title: "Subpath exports",
        label: "Subpath exports",
      },
      {
        slug: "guides/examples",
        src: "README.md",
        sections: ["Examples"],
        title: "Examples",
        label: "Examples",
      },
    ],
  },
  {
    label: "Concepts",
    items: [
      { slug: "concepts/architecture", src: "docs/ARCHITECTURE.md", label: "Architecture" },
      { slug: "concepts/delivery", src: "docs/DELIVERY.md", label: "Delivery & retries" },
      { slug: "concepts/signing", src: "docs/SIGNING.md", label: "Signing & verification" },
      { slug: "concepts/hooks", src: "docs/HOOKS.md", label: "Hooks & the delivery sink" },
    ],
  },
  {
    label: "Storage & frameworks",
    items: [
      { slug: "storage", src: "docs/STORAGE.md", label: "Storage" },
      { slug: "integrations/adapters", src: "docs/ADAPTERS.md", label: "Framework adapters" },
    ],
  },
  {
    label: "Access control",
    items: [
      { slug: "security/auth", src: "docs/AUTH.md", label: "Authentication" },
      { slug: "security/authorization", src: "docs/AUTHORIZATION.md", label: "Authorization" },
    ],
  },
  {
    label: "UI",
    items: [
      { slug: "ui/portal", src: "docs/PORTAL.md", label: "Consumer portal" },
      { slug: "ui/admin", src: "docs/UI.md", label: "Admin UI & React embeds" },
    ],
  },
  {
    label: "Operations",
    items: [
      { slug: "operations/deployment", src: "docs/DEPLOYMENT.md", label: "Deployment" },
      {
        slug: "operations/cli",
        src: "README.md",
        sections: ["CLI"],
        title: "CLI",
        label: "CLI",
      },
      { slug: "operations/testing", src: "docs/TESTING.md", label: "Testing" },
    ],
  },
  // starlight-typedoc's "API reference" group is inserted here by astro.config.ts.
  {
    label: "Project",
    items: [
      {
        slug: "project/ecosystem",
        src: "README.md",
        sections: ["The xtandard ecosystem"],
        title: "The xtandard ecosystem",
        label: "xtandard ecosystem",
      },
      { slug: "project/changelog", src: "CHANGELOG.md", label: "Changelog" },
      {
        label: "Architecture decisions",
        collapsed: true,
        items: adrs.map(([file, label]) => ({
          slug: `project/adr/${file.slice(0, 4)}`,
          src: `docs/ADR/${file}`,
          label,
        })),
      },
      { slug: "project/releases", src: "docs/RELEASES.md", label: "Releases", internal: true },
      { slug: "project/brand", src: "docs/BRAND.md", label: "Brand", internal: true },
      { label: "npm", link: npmUrl },
    ],
  },
];

export const isPage = (i: Item): i is Page => "slug" in i;
export const isGroup = (i: Item): i is Group => "items" in i;

/** Every page, the home page first. */
export function pages(): Page[] {
  const out: Page[] = [home];
  const walk = (items: Item[]) => {
    for (const i of items) {
      if (isPage(i)) out.push(i);
      else if (isGroup(i)) walk(i.items);
    }
  };
  walk(sidebar);
  return out;
}
