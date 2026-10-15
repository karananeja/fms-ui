/**
 * DS3-R1/R4: theme preference (Light / Dark / System) and the resolved theme on `<html>`.
 * React-free like `map-view.ts`; `useTheme()` wraps it. The pre-paint script in `index.html`
 * applies the same rules before the app loads (no flash).
 */
import { THEME_COLOR, type ResolvedTheme } from './theme-colors';

export { THEME_COLOR, type ResolvedTheme };
export type ThemePreference = 'light' | 'dark' | 'system';

export interface ThemeSnapshot {
  preference: ThemePreference;
  resolved: ResolvedTheme;
}

export const THEME_STORAGE_KEY = 'fms.theme';
const QUERY = '(prefers-color-scheme: dark)';

const isPreference = (v: unknown): v is ThemePreference =>
  v === 'light' || v === 'dark' || v === 'system';

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return isPreference(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

function media(): MediaQueryList | null {
  try {
    return typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null;
  } catch {
    return null;
  }
}

export class ThemeStore {
  private pref: ThemePreference = readPreference();
  private current: ResolvedTheme = 'dark';
  /** Stable snapshot for `useSyncExternalStore`; replaced on every change. */
  private snap: ThemeSnapshot = { preference: this.pref, resolved: 'dark' };
  private readonly listeners = new Set<() => void>();
  private mql: MediaQueryList | null = null;
  private readonly onMedia = () => this.apply();
  private readonly onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== THEME_STORAGE_KEY) return;
    const next = readPreference();
    if (next === this.pref) return;
    this.pref = next;
    this.apply();
  };

  constructor() {
    window.addEventListener('storage', this.onStorage);
    this.apply();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** The stored preference. */
  get = (): ThemePreference => this.pref;

  /** Always `light` or `dark`. */
  resolved = (): ResolvedTheme => this.current;

  getSnapshot = (): ThemeSnapshot => this.snap;

  set(pref: ThemePreference): void {
    if (!isPreference(pref)) return;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, pref);
    } catch {
      // Private mode: applies to this page only.
    }
    if (pref === this.pref) return;
    this.pref = pref;
    this.apply();
  }

  /** Tests only. */
  destroy(): void {
    window.removeEventListener('storage', this.onStorage);
    this.watchSystem(false);
    this.listeners.clear();
  }

  private watchSystem(on: boolean): void {
    if (on && !this.mql) {
      this.mql = media();
      this.mql?.addEventListener?.('change', this.onMedia);
    } else if (!on && this.mql) {
      this.mql.removeEventListener?.('change', this.onMedia);
      this.mql = null;
    }
  }

  private apply(): void {
    this.watchSystem(this.pref === 'system');
    const next: ResolvedTheme =
      this.pref === 'system' ? (this.mql?.matches === false ? 'light' : 'dark') : this.pref;
    const root = document.documentElement;
    if (root.dataset.theme !== next) root.dataset.theme = next;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[next]);
    if (next === this.current && this.snap.preference === this.pref) return;
    this.current = next;
    this.snap = { preference: this.pref, resolved: next };
    for (const l of this.listeners) l();
  }
}

let instance: ThemeStore | null = null;

/** The app-wide store, created on first use (never imported by the public share page). */
export function themeStore(): ThemeStore {
  return (instance ??= new ThemeStore());
}
