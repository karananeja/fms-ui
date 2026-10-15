import { useSyncExternalStore } from 'react';
import { themeStore, type ThemePreference, type ThemeSnapshot } from './theme-store';

/** DS3-R4: the theme preference, the resolved theme and a setter. */
export function useTheme(): ThemeSnapshot & { setPreference: (p: ThemePreference) => void } {
  const store = themeStore();
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { ...snap, setPreference: (p) => store.set(p) };
}
