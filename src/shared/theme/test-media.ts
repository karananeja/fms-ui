import { vi } from 'vitest';

/** A controllable `matchMedia('(prefers-color-scheme: dark)')` for jsdom tests. */
export function mockColorScheme(initialDark: boolean) {
  const listeners = new Set<() => void>();
  const mql = {
    matches: initialDark,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => mql),
  );
  return {
    listeners,
    set(dark: boolean) {
      mql.matches = dark;
      for (const l of [...listeners]) l();
    },
  };
}
