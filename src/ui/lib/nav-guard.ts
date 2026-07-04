/**
 * A tiny process-wide navigation guard. A view with unsaved edits registers a
 * blocker; the app's in-app navigation (tabs, project/env switch, opening another
 * flag) calls {@link canLeave} first and aborts if the blocker says no.
 *
 * wouter has no built-in navigation blocker, so this bridges the dirty view to the
 * navigation entry points without prop-drilling. Single active blocker (only one
 * editor is open at a time).
 *
 * @module
 */

/** Returns `true` if navigation is allowed, `false` to block it (e.g. user cancelled). */
type Blocker = () => boolean;

let active: Blocker | null = null;

/** Register the current blocker (replaces any previous one). */
export function setNavBlocker(blocker: Blocker): void {
  active = blocker;
}

/** Clear `blocker` if it is still the active one (safe from stale cleanups). */
export function clearNavBlocker(blocker: Blocker): void {
  if (active === blocker) active = null;
}

/** Consult the active blocker. `true` when navigation may proceed. */
export function canLeave(): boolean {
  return active ? active() : true;
}
