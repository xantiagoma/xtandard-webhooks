// Pre-build step of the documentation site: writes src/content/docs/ (generated, gitignored) from
// the repository's Markdown and the site-only pages in site/content/. The repository files stay
// the single source of truth and keep rendering on GitHub and npm; this step only adapts copies:
//
//   - the title and description come from the source: the H1 (or the manifest's `title`) becomes
//     `title`, the first paragraph becomes `description`, and "Edit page" opens the source file;
//   - README.md is split by its H2 sections into several pages (manifest `sections`); its other
//     sections stay on GitHub;
//   - relative links to files that are pages here (`docs/SIGNING.md`, `#the-xtandard-ecosystem`
//     in the split README) become site routes, pointing at whichever page holds the anchor;
//   - relative links to other repository files (`../src/x.ts`, `../test/…`) become GitHub URLs;
//   - a relative link to a file that does not exist fails the build;
//   - GitHub alerts (`> [!WARNING]`) become Starlight asides.
//
// Fenced code blocks and inline code spans are never rewritten. Anchors are checked after the
// build by starlight-links-validator.
//
//   bun scripts/sync.ts
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import GithubSlugger from "github-slugger";
import {
  branch,
  npmUrl,
  pages,
  repoRoot,
  repoSlug,
  repoUrl,
  siteBase,
  type Page,
} from "../manifest.ts";

const siteDir = join(repoRoot, "site");
const outDir = join(siteDir, "src/content/docs");

const errors: string[] = [];
const fail = (msg: string) => errors.push(msg);

const all = pages();
const route = (slug: string) => (slug === "" ? `${siteBase}/` : `${siteBase}/${slug}/`);
const isExternal = (t: string) => /^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith("//");

// ---- Markdown helpers -----------------------------------------------------------------------

const fence = /^ {0,3}(`{3,}|~{3,})/;

/** Calls `fn` on each line outside fenced code blocks; code lines are kept as they are. */
function mapProse(lines: string[], fn: (line: string) => string): string[] {
  let open: string | null = null;
  return lines.map((line) => {
    const f = fence.exec(line);
    if (open) {
      if (f && f[1]![0] === open[0] && f[1]!.length >= open.length && line.trim() === f[1])
        open = null;
      return line;
    }
    if (f) {
      open = f[1]!;
      return line;
    }
    return fn(line);
  });
}

/** Indexes of the lines outside fenced code blocks. */
function proseLines(lines: string[]): boolean[] {
  const prose: boolean[] = [];
  let open: string | null = null;
  for (const line of lines) {
    const f = fence.exec(line);
    if (open) {
      prose.push(false);
      if (f && f[1]![0] === open[0] && f[1]!.length >= open.length && line.trim() === f[1])
        open = null;
      continue;
    }
    if (f) {
      open = f[1]!;
      prose.push(false);
      continue;
    }
    prose.push(true);
  }
  return prose;
}

/** Plain text of a Markdown inline string (titles, descriptions, heading slugs). */
const plain = (s: string) =>
  s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Replaces the inline code spans of a line with placeholders (CommonMark: a run of n backticks
 * opens a span that the next run of exactly n backticks closes; an unmatched run is literal).
 */
function maskCode(line: string, spans: string[]): string {
  const runs = [...line.matchAll(/`+/g)].map((m) => ({ at: m.index, len: m[0].length }));
  let out = "";
  let pos = 0;
  for (let i = 0; i < runs.length; i++) {
    const open = runs[i]!;
    if (open.at < pos) continue;
    const close = runs.findIndex((r, j) => j > i && r.len === open.len);
    if (close < 0) continue;
    const end = runs[close]!.at + open.len;
    out += `${line.slice(pos, open.at)}\uE000${spans.push(line.slice(open.at, end)) - 1}\uE000`;
    pos = end;
    i = close;
  }
  return out + line.slice(pos);
}

const alertKinds: Record<string, string> = {
  NOTE: "note",
  TIP: "tip",
  IMPORTANT: "note",
  WARNING: "caution",
  CAUTION: "danger",
};

/** GitHub alerts (`> [!WARNING]` + quoted lines) → Starlight asides (`:::caution`). */
function alerts(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/.exec(lines[i]!);
    if (!m) {
      out.push(lines[i]!);
      continue;
    }
    out.push(`:::${alertKinds[m[1]!]}`);
    while (i + 1 < lines.length && lines[i + 1]!.startsWith(">"))
      out.push(lines[++i]!.replace(/^> ?/, ""));
    out.push(":::");
  }
  return out;
}

/** The first paragraph of prose, as a meta description of at most ~200 characters. */
function describe(lines: string[]): string | undefined {
  const para: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (fence.test(line)) {
      inFence = !inFence;
      if (para.length) break;
      continue;
    }
    if (inFence) continue;
    if (line.trim() === "") {
      if (para.length) break;
      continue;
    }
    if (para.length === 0 && /^\s*([#>|<:]|[-*+] |\d+\. |!\[)/.test(line)) continue;
    para.push(line);
  }
  let d = plain(para.join(" "));
  if (!d) return undefined;
  if (d.length > 200) d = `${d.slice(0, 200).replace(/\s+\S*$/, "")}…`;
  return d;
}

const yaml = (v: string) => JSON.stringify(v);

function frontmatter(fields: Record<string, string | boolean | undefined>, extra = ""): string {
  const body = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? yaml(v) : v}`)
    .join("\n");
  return `---\n${body}${extra}\n---\n`;
}

// ---- source documents: H1, H2 blocks and where each anchor lands ----------------------------

type Block = { heading: string | null; start: number; end: number; anchors: Set<string> };
type Doc = { lines: string[]; h1: number; title: string; blocks: Block[] };

const docs = new Map<string, Doc>();

/** Reads a repository Markdown file into its intro block (null heading) and H2 blocks. */
function loadDoc(src: string): Doc | undefined {
  const cached = docs.get(src);
  if (cached) return cached;
  const path = join(repoRoot, src);
  if (!existsSync(path)) {
    fail(`manifest: ${src} does not exist`);
    return undefined;
  }
  const lines = readFileSync(path, "utf8").replace(/\r\n/g, "\n").split("\n");
  const prose = proseLines(lines);
  const slugger = new GithubSlugger();
  let h1 = -1;
  const blocks: Block[] = [{ heading: null, start: 0, end: lines.length, anchors: new Set() }];
  lines.forEach((line, i) => {
    if (!prose[i]) return;
    const h = /^(#{1,6}) (.+?)\s*#*\s*$/.exec(line);
    if (!h) return;
    if (h[1] === "#" && h1 < 0) h1 = i;
    if (h[1] === "##") {
      blocks.at(-1)!.end = i;
      blocks.push({ heading: h[2]!, start: i, end: lines.length, anchors: new Set() });
    }
    blocks.at(-1)!.anchors.add(slugger.slug(plain(h[2]!)));
  });
  const doc: Doc = { lines, h1, title: h1 >= 0 ? plain(lines[h1]!.slice(2)) : "", blocks };
  docs.set(src, doc);
  return doc;
}

/** Which page (slug) holds each H2 block of each source file. */
const blockPage = new Map<string, Map<Block, string>>();
/** Whole-file pages: source → slug. */
const filePage = new Map<string, string>();
/** H2 blocks alone on their page: the heading becomes the title, so its anchor is the page. */
const titleBlocks = new Set<Block>();

for (const p of all) {
  if (!p.src) continue;
  const doc = loadDoc(p.src);
  if (!doc) continue;
  if (!p.sections) {
    filePage.set(p.src, p.slug);
    continue;
  }
  const owners = blockPage.get(p.src) ?? new Map<Block, string>();
  blockPage.set(p.src, owners);
  if (p.intro) owners.set(doc.blocks[0]!, p.slug);
  for (const name of p.sections) {
    const block = doc.blocks.find((b) => b.heading === name);
    if (!block) fail(`${p.src}: no "## ${name}" section for /${p.slug}/`);
    else if (owners.has(block)) fail(`${p.src}: "## ${name}" is on two pages`);
    else {
      owners.set(block, p.slug);
      if (!p.intro && p.sections.length === 1) titleBlocks.add(block);
    }
  }
}

// A split guide (one that is not README.md, whose other sections stay on GitHub) must place every
// H2 on a page.
for (const [src, owners] of blockPage) {
  if (src === "README.md" || filePage.has(src)) continue;
  for (const b of loadDoc(src)!.blocks) {
    if (b.heading === null && !owners.has(b) && b.end - b.start > 0) {
      const text = loadDoc(src)!
        .lines.slice(b.start, b.end)
        .filter((l, i) => b.start + i !== loadDoc(src)!.h1 && l.trim());
      if (text.length) fail(`${src}: the text above the first H2 is on no page (set intro on one)`);
    } else if (b.heading !== null && !owners.has(b)) {
      fail(
        `${src}: "## ${b.heading}" is on no page (add it to a page's sections in site/manifest.ts)`,
      );
    }
  }
}

/** The route of `anchor` (without #) in source `src`, or undefined when no page shows it. */
function anchorRoute(src: string, anchor: string): string | undefined {
  const whole = filePage.get(src);
  if (whole !== undefined) return `${route(whole)}${anchor ? `#${anchor}` : ""}`;
  const owners = blockPage.get(src);
  const doc = docs.get(src);
  if (!owners || !doc) return undefined;
  if (!anchor) {
    const first = doc.blocks.find((b) => owners.has(b));
    return first ? route(owners.get(first)!) : undefined;
  }
  for (const [b, slug] of owners) {
    if (!b.anchors.has(anchor)) continue;
    // The H2's own anchor (the first in the block) is gone when that H2 became the page title.
    if (titleBlocks.has(b) && b.anchors.values().next().value === anchor) return route(slug);
    return `${route(slug)}#${anchor}`;
  }
  return undefined;
}

// ---- link rewriting -------------------------------------------------------------------------

/** Rewrites one link target found in `src`. `image` targets get a URL that serves the bytes. */
function rewrite(target: string, src: string, image: boolean): string {
  if (target === "" || isExternal(target)) return target;
  if (target.startsWith("#")) {
    // In a split guide the anchor may now live on a sibling page.
    if (!blockPage.has(src)) return target;
    const to = anchorRoute(src, target.slice(1));
    if (to) return to;
    return `${repoUrl}/blob/${branch}/${src}${target}`;
  }
  const m = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(target)!;
  let path: string;
  try {
    path = decodeURIComponent(m[1]!);
  } catch {
    fail(`${src}: malformed link ${target}`);
    return target;
  }
  const hash = m[3] ?? "";
  const resolved = posix
    .normalize(path.startsWith("/") ? path.slice(1) : posix.join(posix.dirname(src), path))
    .replace(/\/$/, "");
  if (resolved.startsWith("..")) {
    fail(`${src}: link ${target} leaves the repository`);
    return target;
  }
  const abs = join(repoRoot, resolved === "." ? "" : resolved);
  if (!existsSync(abs)) {
    fail(`${src}: broken link ${target} (${resolved} does not exist)`);
    return target;
  }
  if (image) return `https://raw.githubusercontent.com/${repoSlug}/${branch}/${resolved}`;
  const to = anchorRoute(resolved, hash.slice(1));
  if (to) return to;
  const kind = statSync(abs).isDirectory() ? "tree" : "blob";
  return `${repoUrl}/${kind}/${branch}/${resolved}${m[2] ?? ""}${hash}`;
}

/** Rewrites the link targets on one prose line, leaving inline code spans alone. */
function rewriteLine(line: string, src: string): string {
  const spans: string[] = [];
  let text = maskCode(line, spans);
  text = text.replace(
    /(!?)\[((?:[^[\]]|\[[^\]]*\])*)\]\(\s*(<[^>]*>|[^)\s]+)((?:\s+"[^"]*")?\s*)\)/g,
    (_s, bang, label, t, title) => {
      const bare = t.startsWith("<") ? t.slice(1, -1) : t;
      const out = rewrite(bare, src, bang === "!");
      return `${bang}[${label}](${t.startsWith("<") ? `<${out}>` : out}${title})`;
    },
  );
  text = text.replace(
    /^( {0,3}\[[^\]]+\]:\s*)(\S+)/,
    (_s, head, t) => head + rewrite(t, src, false),
  );
  text = text.replace(
    /\b(href|src)="([^"]*)"/g,
    (_s, attr, t) => `${attr}="${rewrite(t, src, attr === "src")}"`,
  );
  return text.replace(/\uE000(\d+)\uE000/g, (_s, i) => spans[Number(i)]!);
}

// ---- pages ----------------------------------------------------------------------------------

const internalBanner = `\nbanner:\n  content: ${yaml("Contributor documentation: how the project is built and released. Not needed to use the library.")}`;

function fromRepo(p: Page): string {
  const src = p.src!;
  const doc = loadDoc(src);
  if (!doc) return "";
  let body: string[];
  let title: string;
  if (p.sections) {
    const owners = blockPage.get(src)!;
    const mine = doc.blocks.filter((b) => owners.get(b) === p.slug);
    body = mine.flatMap((b) => {
      const lines = doc.lines.slice(b.start, b.end);
      // Drop the H1 (it becomes the title) and anything above it (a logo).
      return b.heading === null && doc.h1 >= 0 ? lines.slice(doc.h1 - b.start + 1) : lines;
    });
    title = p.title ?? (p.intro ? doc.title : (p.sections[0] ?? ""));
    // A single-section page drops its own H2: the title already says it.
    if (!p.intro && p.sections.length === 1) body = body.slice(1);
  } else {
    if (doc.h1 < 0) {
      fail(`${src}: no H1 to take the title from`);
      return "";
    }
    const pre = doc.lines.slice(0, doc.h1).filter((l) => l.trim() !== "");
    if (pre.some((l) => !/^\s*(<|!\[)/.test(l))) fail(`${src}: unexpected text before the H1`);
    title = p.title ?? doc.title;
    body = doc.lines.slice(doc.h1 + 1);
  }
  const description = describe(body);
  const text = mapProse(alerts(body), (l) => rewriteLine(l, src)).join("\n");
  return (
    frontmatter(
      {
        title,
        description,
        editUrl: `${repoUrl}/edit/${branch}/${src}`,
        pagefind: p.internal ? false : undefined,
      },
      p.internal ? internalBanner : "",
    ) + text.replace(/^\n+/, "\n")
  );
}

async function fromSite(p: Page): Promise<string> {
  const path = join(siteDir, "content", p.site!);
  if (!existsSync(path)) {
    fail(`manifest: site/content/${p.site} does not exist`);
    return "";
  }
  let text = await Bun.file(path).text();
  text = text
    .replaceAll("@BASE@", siteBase)
    .replaceAll("@REPO@", repoUrl)
    .replaceAll("@NPM@", npmUrl);
  if (!/^---\n[\s\S]*?\neditUrl:/.test(text)) {
    text = text.replace(
      /^---\n/,
      `---\neditUrl: ${yaml(`${repoUrl}/edit/${branch}/site/content/${p.site}`)}\n`,
    );
  }
  const left = /@[A-Z_]+@/.exec(text.replace(/```[\s\S]*?```/g, ""));
  if (left) fail(`site/content/${p.site}: unreplaced ${left[0]}`);
  return text;
}

rmSync(outDir, { recursive: true, force: true });
let written = 0;
for (const p of all) {
  const text = p.site ? await fromSite(p) : fromRepo(p);
  if (!text) continue;
  const ext = p.site?.endsWith(".mdx") ? "mdx" : "md";
  const file = join(outDir, p.slug === "" ? `index.${ext}` : `${p.slug}.${ext}`);
  mkdirSync(dirname(file), { recursive: true });
  await Bun.write(file, text);
  written++;
}

// Every Markdown file under docs/ must be in the manifest, so a new guide is not forgotten.
const covered = new Set(all.map((p) => p.src).filter(Boolean));
for (const f of new Bun.Glob("docs/**/*.md").scanSync({ cwd: repoRoot })) {
  if (!covered.has(f)) fail(`${f} is not in site/manifest.ts (add it to the sidebar)`);
}

if (errors.length > 0) {
  for (const e of errors) console.error(`sync: ${e}`);
  console.error(`sync: ${errors.length} error(s)`);
  process.exit(1);
}
console.log(`sync: ${written} pages in site/src/content/docs (base ${siteBase})`);
