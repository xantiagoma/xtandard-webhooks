/**
 * Theme preference: `system` (follows the OS), `light`, or `dark`. The
 * preference is persisted in localStorage; `system` live-updates when the OS
 * scheme changes.
 *
 * The standalone SPA writes the resolved theme to `<html data-theme>` (see
 * {@link initTheme}). The React embed never touches the host document: it puts
 * `data-theme` on its own wrapper, either from this preference (`theme="auto"`)
 * or from the host page's theme ({@link detectHostTheme}, `theme="inherit"`).
 */
export type ThemePref = "system" | "light" | "dark";

/** A concrete, resolved theme. */
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "xtandard-webhooks:theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

const listeners = new Set<(pref: ThemePref) => void>();

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
  return typeof matchMedia !== "undefined" && matchMedia(DARK_QUERY).matches;
}

/** The concrete theme a preference resolves to right now. */
export function resolveTheme(pref: ThemePref): ResolvedTheme {
  return pref === "system" ? (prefersDark() ? "dark" : "light") : pref;
}

/** Persist a preference and notify subscribers (the SPA root, embedded dashboards). */
export function setThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* ignore */
  }
  for (const listener of listeners) listener(pref);
}

/** Subscribe to preference changes made via {@link setThemePref}. Returns an unsubscribe. */
export function subscribeThemePref(listener: (pref: ThemePref) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Subscribe to OS color-scheme changes. Returns an unsubscribe. */
export function subscribeSystemTheme(listener: () => void): () => void {
  if (typeof matchMedia === "undefined") return () => {};
  const query = matchMedia(DARK_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

function applyToDocument(pref: ThemePref): void {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = resolveTheme(pref);
  }
}

/**
 * Standalone SPA: apply the stored preference to `<html data-theme>`, follow
 * later changes, and keep `system` in sync with the OS. Call once at boot.
 */
export function initTheme(): void {
  applyToDocument(getThemePref());
  subscribeThemePref(applyToDocument);
  subscribeSystemTheme(() => {
    if (getThemePref() === "system") applyToDocument("system");
  });
}

/** Read an explicit theme off one element: a `dark`/`light` class or `data-theme`. */
function themeOf(el: Element | null | undefined): ResolvedTheme | undefined {
  if (!el) return undefined;
  if (el.classList.contains("dark")) return "dark";
  if (el.classList.contains("light")) return "light";
  const attr = el.getAttribute("data-theme");
  if (attr === "dark" || attr === "light") return attr;
  return undefined;
}

/**
 * The host page's theme, for `theme="inherit"`: a `dark`/`light` class or
 * `data-theme` attribute on `<html>` (then `<body>`) — the conventions used by
 * class- and attribute-based theme switchers — falling back to the OS
 * `prefers-color-scheme` when the host sets neither.
 */
export function detectHostTheme(): ResolvedTheme {
  if (typeof document === "undefined") return "light";
  return (
    themeOf(document.documentElement) ??
    themeOf(document.body) ??
    (prefersDark() ? "dark" : "light")
  );
}

/**
 * Call `listener` whenever the host page's theme may have changed: `class` /
 * `data-theme` / `style` mutations on `<html>` or `<body>`, or an OS scheme
 * change. Returns an unsubscribe.
 */
export function watchHostTheme(listener: () => void): () => void {
  const unsubscribeSystem = subscribeSystemTheme(listener);
  if (typeof MutationObserver === "undefined" || typeof document === "undefined") {
    return unsubscribeSystem;
  }
  const observer = new MutationObserver(listener);
  const options = { attributes: true, attributeFilter: ["class", "data-theme", "style"] };
  observer.observe(document.documentElement, options);
  if (document.body) observer.observe(document.body, options);
  return () => {
    observer.disconnect();
    unsubscribeSystem();
  };
}
