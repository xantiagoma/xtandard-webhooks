/**
 * Theme preference: `system` (follows the OS), `light`, or `dark`. The resolved
 * value is written to `<html data-theme>`; the preference is persisted in
 * localStorage. `system` live-updates when the OS scheme changes.
 */
export type ThemePref = "system" | "light" | "dark";

const STORAGE_KEY = "xtandard-webhooks:theme";

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* ignore */
  }
  return "system";
}

function prefersDark(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
}

/** The concrete theme a preference resolves to right now. */
export function resolveTheme(pref: ThemePref): "light" | "dark" {
  return pref === "system" ? (prefersDark() ? "dark" : "light") : pref;
}

function apply(pref: ThemePref): void {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = resolveTheme(pref);
  }
}

export function setThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* ignore */
  }
  apply(pref);
}

/** Apply the stored preference and keep `system` in sync with the OS. Call once at boot. */
export function initTheme(): void {
  apply(getThemePref());
  if (typeof matchMedia !== "undefined") {
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (getThemePref() === "system") apply("system");
    });
  }
}
