// A Starlight plugin that runs after starlight-typedoc and writes the API reference's overview
// pages, which the generator does not emit: /api/ (every entry point, with its import path and
// description) and /api/<module>/ (that entry point's members, grouped by kind, with summaries).
// The description is the `@module` doc comment at the top of each entry file (src/index.ts,
// src/core.ts, src/entry-*.ts…), so it is written once, next to the code.
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StarlightPlugin } from "@astrojs/starlight/types";
import { entries, packageName, repoRoot, repoUrl, rootModule, siteBase } from "../manifest.ts";
import { reexportsFile, type Reexport } from "./typedoc-plugin.ts";

const kinds = [
  ["functions", "Functions"],
  ["classes", "Classes"],
  ["interfaces", "Interfaces"],
  ["type-aliases", "Type aliases"],
  ["variables", "Variables"],
  ["enumerations", "Enumerations"],
  ["namespaces", "Namespaces"],
] as const;

type Member = { name: string; route: string; summary: string };
type Module = {
  name: string;
  importPath: string;
  source: string;
  description: string;
  members: Map<string, Member[]>;
};

const yaml = (v: string) => JSON.stringify(v);

/** The module's doc comment without the `Import from` line and the tags. */
function moduleDescription(source: string): string {
  const text = readFileSync(join(repoRoot, source), "utf8");
  const m = /^\/\*\*([\s\S]*?)\*\//.exec(text);
  if (!m) return "";
  return m[1]!
    .split("\n")
    .map((l) => l.replace(/^\s*\* ?/, ""))
    .filter((l) => !l.startsWith("Import from ") && !l.startsWith("@"))
    .join("\n")
    .trim()
    .replace(/\{@link\s+([^}\s|]+)(?:\s*\|\s*|\s+)?([^}]*)\}/g, (_s, target, text) =>
      text ? text : `\`${target.replace(/^\.\//, "")}\``,
    )
    .replace(/\n{3,}/g, "\n\n");
}

/** A generated member page's title and the first prose paragraph after its "Defined in" line. */
function member(file: string, route: string, fallbackName = ""): Member {
  const text = readFileSync(file, "utf8");
  const title = /^title: (.+)$/m.exec(text)?.[1];
  const name = title ? (JSON.parse(title) as string) : fallbackName;
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.startsWith("Defined in:"));
  let summary = "";
  if (at >= 0) {
    const para: string[] = [];
    for (const l of lines.slice(at + 1)) {
      if (l.trim() === "") {
        if (para.length) break;
        continue;
      }
      if (/^(#|```|\||:::|>)/.test(l)) break;
      para.push(l.trim());
    }
    summary = para.join(" ");
  }
  return { name, route, summary };
}

function collect(apiDir: string): Module[] {
  const byName = new Map(entries().map((e) => [e.module, e]));
  const modules: Module[] = [];
  const walk = (dir: string, name: string) => {
    const dirs = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    const kindDirs = new Set<string>(kinds.map(([k]) => k));
    if (name && dirs.some((e) => kindDirs.has(e.name))) {
      const entry = byName.get(name);
      const members = new Map<string, Member[]>();
      for (const [kind] of kinds) {
        const kdir = join(dir, kind);
        if (!existsSync(kdir)) continue;
        // A namespace is a folder with its own generated index.md; other members are files.
        const list = readdirSync(kdir, { withFileTypes: true })
          .map((e) =>
            e.isDirectory()
              ? existsSync(join(kdir, e.name, "index.md"))
                ? member(
                    join(kdir, e.name, "index.md"),
                    `${siteBase}/api/${name}/${kind}/${e.name}/`.toLowerCase(),
                    e.name,
                  )
                : undefined
              : e.name.endsWith(".md")
                ? member(
                    join(kdir, e.name),
                    `${siteBase}/api/${name}/${kind}/${e.name.slice(0, -3)}/`.toLowerCase(),
                  )
                : undefined,
          )
          .filter((x): x is Member => x !== undefined)
          .sort((a, b) => a.name.localeCompare(b.name));
        if (list.length) members.set(kind, list);
      }
      modules.push({
        name,
        importPath: entry?.importPath ?? `${packageName}/${name}`,
        source: entry?.source ?? "",
        description: entry ? moduleDescription(entry.source) : "",
        members,
      });
    }
    for (const e of dirs)
      if (!kindDirs.has(e.name)) walk(join(dir, e.name), name ? `${name}/${e.name}` : e.name);
  };
  walk(apiDir, "");
  // The root first, then by import path.
  return modules.sort((a, b) =>
    a.name === rootModule ? -1 : b.name === rootModule ? 1 : a.name.localeCompare(b.name),
  );
}

const firstSentence = (s: string) => {
  const flat = s.replace(/\s+/g, " ").trim();
  const m = /^(.+?\.)(\s|$)/.exec(flat);
  return m ? m[1]! : flat;
};

function modulePage(m: Module, reexports: Reexport[]): string {
  const out = [
    "---",
    `title: ${yaml(m.importPath)}`,
    `description: ${yaml(firstSentence(m.description) || `API reference for ${m.importPath}.`)}`,
    `editUrl: ${m.source ? yaml(`${repoUrl}/edit/main/${m.source}`) : "false"}`,
    "next: false",
    "prev: false",
    "---",
    "",
    m.description,
    "",
    "```ts",
    `import { … } from "${m.importPath}";`,
    "```",
    "",
  ];
  // A symbol several entry points export is documented once, under the first (astro.config.ts
  // apiOwners); say which other entry points this one re-exports from (`export … from "./x"`).
  const from = m.source
    ? new Set(
        [
          ...readFileSync(join(repoRoot, m.source), "utf8").matchAll(
            /\bexport\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+"\.\/([^"]+)"/g,
          ),
        ].map((x) => `src/${x[1]}`),
      )
    : new Set<string>();
  const others = entries().filter((e) => e.source !== m.source && from.has(e.source));
  if (others.length)
    out.push(
      `Also re-exports symbols of ${others
        .map((e) => `[\`${e.importPath}\`](${siteBase}/api/${e.module}/)`)
        .join(", ")}, documented on those pages.`,
      "",
    );
  for (const [kind, label] of kinds) {
    const list = m.members.get(kind);
    if (!list) continue;
    out.push(`## ${label}`, "", "| Name | Summary |", "| --- | --- |");
    for (const x of list)
      out.push(`| [\`${x.name}\`](${x.route}) | ${x.summary.replaceAll("|", "\\|")} |`);
    out.push("");
  }
  // Re-exports of symbols documented on another module page the sentence above doesn't name
  // (e.g. the Elysia 2 adapter's `webhooksPanel`, shared with and documented under the Elysia 1 one).
  const covered = new Set(others.map((e) => e.module));
  const listed = reexports
    .filter((r) => r.module === m.name && !covered.has(r.owner))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (listed.length) {
    out.push("## Re-exports", "", "| Name | Documented on |", "| --- | --- |");
    for (const r of listed) {
      const owner = entries().find((e) => e.module === r.owner)?.importPath ?? r.owner;
      const route = `${siteBase}/api/${r.owner}/${r.kind}/${r.target}/`.toLowerCase();
      const label = r.name === r.target ? `\`${r.name}\`` : `\`${r.name}\` (\`${r.target}\`)`;
      out.push(`| [${label}](${route}) | [\`${owner}\`](${siteBase}/api/${r.owner}/) |`);
    }
    out.push("");
  }
  return out.join("\n");
}

function indexPage(modules: Module[]): string {
  const out = [
    "---",
    'title: "API reference"',
    `description: ${yaml(`Every entry point of ${packageName} and its exports, generated from the TypeScript source and its doc comments.`)}`,
    "editUrl: false",
    "next: false",
    "prev: false",
    "---",
    "",
    "Generated from the source by [TypeDoc](https://typedoc.org/), so it always matches the published",
    "types. Each entry point is a separate import; storage adapters, framework adapters and the React",
    "embeds have **optional peer dependencies**, installed only when you use them. A symbol that",
    "several entry points export (the root re-exports `/core`, `/schema` and `/signing`) is documented",
    "once, under the entry point it comes from; the others link to it (a module page's _Re-exports_).",
    `See also [Subpath exports](${siteBase}/guides/subpath-exports/).`,
    "",
    "| Import | Exports | Description |",
    "| --- | --- | --- |",
  ];
  for (const m of modules) {
    const count = [...m.members.values()].reduce((n, l) => n + l.length, 0);
    out.push(
      `| [\`${m.importPath}\`](${siteBase}/api/${m.name}/) | ${count} | ${firstSentence(m.description).replaceAll("|", "\\|")} |`,
    );
  }
  out.push("");
  return out.join("\n");
}

export function apiOverviews(): StarlightPlugin {
  return {
    name: "xtandard-webhooks-api-overviews",
    hooks: {
      "config:setup"({ astroConfig, command, logger }) {
        if (command === "preview") return;
        const apiDir = join(new URL(astroConfig.srcDir).pathname, "content/docs/api");
        if (!existsSync(apiDir)) {
          logger.warn("no generated API reference to index");
          return;
        }
        const modules = collect(apiDir);
        const reexports: Reexport[] = existsSync(reexportsFile)
          ? JSON.parse(readFileSync(reexportsFile, "utf8"))
          : [];
        for (const m of modules)
          writeFileSync(join(apiDir, m.name, "index.md"), modulePage(m, reexports));
        writeFileSync(join(apiDir, "index.md"), indexPage(modules));
        // The generator's own root listing links to module pages it never emits; index.md replaces it.
        rmSync(join(apiDir, "README.md"), { force: true });
        logger.info(`API overviews: ${modules.length} modules`);
      },
    },
  };
}
