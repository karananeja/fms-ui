export type ResolvedTheme = 'light' | 'dark';

/**
 * `<meta name="theme-color">` per theme, = `--surface-solid` (DS3-R3). The pre-paint script in
 * `index.html` repeats them; both are checked against `theme.css` in unit tests.
 */
export const THEME_COLOR: Record<ResolvedTheme, string> = { dark: '#0a0d11', light: '#ffffff' };
