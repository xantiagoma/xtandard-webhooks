/**
 * Regression test for the React-embed CSS scoping (upstream report:
 * @xtandard/webhooks/react/styles.css was a global unscoped Tailwind build that
 * restyled the whole host app). Exercises the same transform the build runs.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import { findUnscopedLeaks, SCOPE, scopeCss } from "../scripts/scope-embed-css.ts";
import { portalContainerRef, setPortalContainerRef } from "../src/ui/lib/portal-container.ts";

// A representative slice of the real Tailwind v4 embed output.
const SAMPLE = [
  "/*! tailwindcss v4 */",
  "@layer properties{@supports (x:y){*,:before,:after,::backdrop{--tw-translate-x:0}}}",
  "html,:host{-webkit-text-size-adjust:100%;line-height:1.5}",
  "*,:before,:after{box-sizing:border-box;border:0 solid}",
  "button,input{font:inherit}",
  "a{color:inherit}",
  ":root{--background:#fff;--foreground:#0a0a0a}",
  ".flex{display:flex}",
  ".border{border-width:1px}",
  ".px-4{padding-inline:1rem}",
  "@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}",
].join("");

describe("embed CSS scoping", () => {
  it("prefixes preflight resets and utilities with the wrapper scope", async () => {
    const out = await scopeCss(SAMPLE);
    // Utilities are scoped, not global.
    expect(out).toContain(`${SCOPE} .flex{`);
    expect(out).toContain(`${SCOPE} .border{`);
    expect(out).not.toMatch(/}\.flex\{/); // no bare top-level utility
    // The universal preflight reset is scoped to the wrapper's subtree.
    expect(out).toContain(`${SCOPE} *`);
    expect(out).toContain(`${SCOPE} button`);
  });

  it("re-homes :root / html design tokens onto the wrapper itself", async () => {
    const out = await scopeCss(SAMPLE);
    expect(out).toContain(`${SCOPE}{--background:#fff`);
    // Not left on the document root.
    expect(out).not.toMatch(/(^|})[:]root\{/);
    expect(out).not.toMatch(/(^|})html\{/);
  });

  it("leaves @keyframes steps untouched", async () => {
    const out = await scopeCss(SAMPLE);
    expect(out).toContain("@keyframes spin{from{");
    expect(out).not.toContain(`${SCOPE} from`);
  });

  it("passes the leak guardrail after scoping, and catches an unscoped build", async () => {
    expect(findUnscopedLeaks(await scopeCss(SAMPLE))).toEqual([]);
    // The raw (pre-scope) sample must be flagged — proves the guard has teeth.
    expect(findUnscopedLeaks(SAMPLE).length).toBeGreaterThan(0);
  });
});

describe("portal container singleton", () => {
  it("defaults to undefined (Base UI → document.body) and is settable/resettable", () => {
    expect(portalContainerRef()).toBeUndefined();
    const ref = { current: null };
    setPortalContainerRef(ref);
    expect(portalContainerRef()).toBe(ref);
    setPortalContainerRef(undefined);
    expect(portalContainerRef()).toBeUndefined();
  });
});
