/**
 * Where Base UI portals (Select/Combobox popups, Dialogs) render.
 *
 * In the **standalone SPA** the stylesheet is global, so portals default to
 * `document.body` and look right. In the **React embed** the stylesheet is
 * scoped under `.xtandard-webhooks` (see `scripts/scope-embed-css.ts`), so
 * anything portaled to `document.body` would fall outside the scope and render
 * unstyled. The embed therefore points portals at its own wrapper element via
 * {@link setPortalContainerRef}, keeping popups inside the scoped subtree.
 *
 * Module-level singleton (same trade-off as `setApiBase`/`setApiToken`): one
 * embed per page. Unset → portals default to `document.body`.
 *
 * @module
 */

import type { RefObject } from "react";

let sharedRef: RefObject<HTMLElement | null> | undefined;

/** Point portals at `ref` (the embed wrapper). Pass `undefined` to reset to the body default. */
export function setPortalContainerRef(ref: RefObject<HTMLElement | null> | undefined): void {
  sharedRef = ref;
}

/**
 * The current portal container ref, or `undefined` when none is set (Base UI
 * then defaults to `document.body`). Pass the result to a Base UI
 * `*.Portal container={…}` prop.
 */
export function portalContainerRef(): RefObject<HTMLElement | null> | undefined {
  return sharedRef;
}
