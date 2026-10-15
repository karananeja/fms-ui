import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockColorScheme } from './test-media';
import { THEME_COLOR, THEME_STORAGE_KEY, ThemeStore } from './theme-store';

const html = document.documentElement;
const meta = () => document.querySelector('meta[name="theme-color"]')!.getAttribute('content');
let store: ThemeStore | undefined;

beforeEach(() => {
  localStorage.clear();
  delete html.dataset.theme;
  document.head.innerHTML = '<meta name="theme-color" content="#000000" />';
});
afterEach(() => {
  store?.destroy();
  store = undefined;
  vi.unstubAllGlobals();
});

describe('DS3-T3: theme store', () => {
  it('defaults to system and follows the OS until a fixed theme is chosen', () => {
    const os = mockColorScheme(false);
    store = new ThemeStore();
    expect(store.get()).toBe('system');
    expect(store.resolved()).toBe('light');
    expect(html.dataset.theme).toBe('light');
    expect(meta()).toBe(THEME_COLOR.light);

    const seen = vi.fn();
    store.subscribe(seen);
    os.set(true);
    expect(html.dataset.theme).toBe('dark');
    expect(meta()).toBe(THEME_COLOR.dark);
    expect(seen).toHaveBeenCalledTimes(1);

    store.set('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(html.dataset.theme).toBe('light');
    expect(os.listeners.size).toBe(0);
    os.set(false);
    os.set(true);
    expect(html.dataset.theme).toBe('light');
  });

  it('set() persists, updates data-theme and gives a new snapshot', () => {
    mockColorScheme(true);
    store = new ThemeStore();
    const before = store.getSnapshot();
    store.set('dark');
    expect(store.getSnapshot()).not.toBe(before);
    expect(store.getSnapshot()).toEqual({ preference: 'dark', resolved: 'dark' });
    store.set('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(html.dataset.theme).toBe('light');
  });

  it('syncs from a storage event (another tab)', () => {
    mockColorScheme(true);
    store = new ThemeStore();
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY }));
    expect(store.get()).toBe('light');
    expect(html.dataset.theme).toBe('light');
  });

  it('an unknown value or a throwing localStorage counts as system', () => {
    mockColorScheme(false);
    localStorage.setItem(THEME_STORAGE_KEY, 'neon');
    store = new ThemeStore();
    expect(store.get()).toBe('system');
    store.destroy();

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    store = new ThemeStore();
    expect(store.get()).toBe('system');
    expect(store.resolved()).toBe('light');
    store.set('dark');
    expect(html.dataset.theme).toBe('dark');
  });
});
