/**
 * Post-build step for the React embed stylesheet.
 *
 * `vite build --config vite.react.config.ts` emits `dist/react.css` as a full,
 * unscoped Tailwind build — global preflight element resets (`*`, `button`,
 * `h1`, `a`, …) plus generic utilities (`.flex`, `.border`, …). Imported by a
 * host app (`@xtandard/webhooks/react/styles.css`) that would restyle the whole
 * page, not just the embedded dashboard.
 *
 * This scopes every rule under the embed's wrapper class (`.xtandard-webhooks`,
 * see src/react.tsx) so the stylesheet is inert outside the dashboard. The
 * design-token `:root`/`html` blocks are re-homed onto the wrapper itself, and
 * keyframe steps are left untouched. The standalone SPA build (dist/ui) is not
 * processed — it legitimately owns the whole document and keeps a global
 * preflight.
 *
 * Run: `bun scripts/scope-embed-css.ts` (chained in the `build:react` script).
 *
 * @module
 */

import postcss from "postcss";
import prefixSelector from "postcss-prefix-selector";

/** The wrapper class the embed renders under (see src/react.tsx). */
export const SCOPE = ".xtandard-webhooks";
const CSS_PATH = new URL("../dist/react.css", import.meta.url);

/**
 * Prefix every rule in `css` with {@link SCOPE}, re-homing `:root`/`html`/`:host`
 * onto the wrapper and leaving keyframe steps alone. Pure — used by the build
 * step and its regression test.
 */
export async function scopeCss(css: string): Promise<string> {
  const result = await postcss([
    prefixSelector({
      prefix: SCOPE,
      transform(prefix: string, selector: string, prefixedSelector: string): string {
        // Keyframe steps (`from`, `to`, `47%`) are not element selectors.
        if (/^(\d+%|from|to)$/.test(selector.trim())) return selector;
        // Design tokens live on :root/html — re-home them onto the wrapper so
        // the embed's own scope carries them (the host <html> is untouched).
        if (selector === ":root" || selector === "html" || selector === ":host") return prefix;
        return prefixedSelector;
      },
    }),
  ]).process(css, { from: undefined });
  return result.css;
}

/**
 * Rules that would restyle the host document if they escaped the scope
 * (preflight resets + the universal custom-property rule). Returns the
 * offending rule fragments (empty when fully scoped) — the resolved-criterion
 * from the upstream report.
 */
export function findUnscopedLeaks(css: string): string[] {
  return css
    .split("}")
    .filter((rule) => /text-size-adjust|^\s*\*[,{]|^\s*(button|a|h1|table)[,{]/.test(rule))
    .filter((rule) => !rule.includes(SCOPE));
}

async function main(): Promise<void> {
  const css = await Bun.file(CSS_PATH).text();
  const scoped = await scopeCss(css);
  await Bun.write(CSS_PATH, scoped);

  const leaks = findUnscopedLeaks(scoped);
  if (leaks.length > 0) {
    console.error(
      `[scope-embed-css] ${leaks.length} unscoped rule(s) leaked:\n${leaks.slice(0, 3).join("\n")}`,
    );
    process.exit(1);
  }
  console.log(`[scope-embed-css] scoped dist/react.css under ${SCOPE}`);
}

if (import.meta.main) await main();
