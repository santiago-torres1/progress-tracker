/*
 * The one thing the navigation column remembers between visits: whether it is collapsed.
 *
 * Every access is wrapped, the same way `lib/supabaseAuth.ts` wraps its own. Safari in private
 * mode throws on `setItem`, a sandboxed iframe has no `localStorage` at all, and a browser with
 * storage disabled throws on the first read. None of those should cost anybody the app — the
 * column simply opens expanded, which is the state it ships in anyway.
 */

const COLLAPSED_KEY = 'progress-tracker.nav-collapsed.v1';

/**
 * `globalThis.localStorage`, typed as the optional thing it really is.
 *
 * The DOM lib declares it as always present. It is not, and widening it here is what makes the
 * check below a real check rather than dead code the linter is right to complain about.
 */
function browserStorage(): Storage | undefined {
  return (globalThis as { localStorage?: Storage }).localStorage;
}

/** Collapsed only when it was explicitly stored as such; anything else means expanded. */
export function readNavCollapsed(storage: Storage | undefined = browserStorage()): boolean {
  if (storage === undefined) return false;
  try {
    return storage.getItem(COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function rememberNavCollapsed(
  collapsed: boolean,
  storage: Storage | undefined = browserStorage(),
): void {
  if (storage === undefined) return;
  try {
    storage.setItem(COLLAPSED_KEY, collapsed ? 'true' : 'false');
  } catch {
    // Storage blocked: the preference lasts this visit and no longer. Nothing else is lost.
  }
}
