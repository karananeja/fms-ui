let mapModule: Promise<typeof import('./share-map-controller')> | null = null;
/**
 * Starts loading MapLibre + the controller (once). The page calls it on mount, so the map code
 * downloads while the share is fetched and the socket connects (first-marker budget, spec §3).
 */
export function preloadShareMap() {
  mapModule ??= import('./share-map-controller');
  return mapModule;
}
