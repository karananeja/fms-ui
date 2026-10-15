/**
 * Camera-only view controls (zoom step, 2D/3D) that need no fleet state (DS1-R7/R10, D-060).
 * React-free: the toolbar calls it, `MapController` listens.
 */
export type MapViewCommand = { type: 'zoom'; delta: 1 | -1 };

const STORAGE_KEY = 'fms.map.3d';

function read3d(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

class MapView {
  private is3d = read3d();
  private readonly listeners = new Set<() => void>();
  private readonly commandListeners = new Set<(cmd: MapViewCommand) => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  onCommand = (listener: (cmd: MapViewCommand) => void): (() => void) => {
    this.commandListeners.add(listener);
    return () => this.commandListeners.delete(listener);
  };

  get3d = (): boolean => this.is3d;

  set3d(on: boolean): void {
    if (on === this.is3d) return;
    this.is3d = on;
    try {
      localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
    } catch {
      // Private mode: the choice just isn't remembered.
    }
    for (const l of this.listeners) l();
  }

  /** DS3-R14: basemap swaps after a theme change (shown in the dev debug overlay). */
  private swaps = 0;
  private readonly swapListeners = new Set<() => void>();
  themeSwaps = (): number => this.swaps;
  subscribeSwaps = (listener: () => void): (() => void) => {
    this.swapListeners.add(listener);
    return () => this.swapListeners.delete(listener);
  };
  noteThemeSwap(): void {
    this.swaps++;
    for (const l of this.swapListeners) l();
  }

  zoom(delta: 1 | -1): void {
    for (const l of this.commandListeners) l({ type: 'zoom', delta });
  }
}

export const mapView = new MapView();
export type { MapView };
