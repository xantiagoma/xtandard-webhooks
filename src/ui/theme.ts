/**
 * Theme preference: `system` (follows the OS), `light`, or `dark`, persisted
 * under the `xtandard-webhooks:theme` localStorage key. The store is
 * `@xtandard/kit/ui`'s; the standalone SPA applies it to `<html data-theme>`,
 * and the React embed puts `data-theme` on its own wrapper, either from this
 * preference (`theme="auto"`) or from the host page (`theme="inherit"`,
 * {@link detectHostTheme}).
 */

import { createThemeStore } from "@xtandard/kit/ui";

export { detectHostTheme, type ResolvedTheme, type ThemePref } from "@xtandard/kit/ui";

/** The webhooks theme store (one per page, shared by the SPA and the embeds). */
export const themeStore = createThemeStore("xtandard-webhooks:theme");

/** Read and write the persisted preference. */
export const { getThemePref, setThemePref } = themeStore;
