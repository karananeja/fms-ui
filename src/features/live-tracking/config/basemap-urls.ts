// Kept apart from `map-config.ts`, which the worker and node-side tools also compile (no Vite env).
/**
 * Basemap per resolved theme (DS3-R12, D-117): OpenFreeMap `dark` / `positron` unless the env
 * overrides them (e2e points both at offline blank styles). Shared with the request mini-map.
 */
export const MAP_STYLE_URLS = {
  dark: import.meta.env.VITE_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/dark',
  light:
    import.meta.env.VITE_MAP_STYLE_URL_LIGHT || 'https://tiles.openfreemap.org/styles/positron',
} as const;
