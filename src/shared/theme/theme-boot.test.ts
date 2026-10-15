import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import html from '../../../index.html?raw';
import { THEME_COLOR } from './theme-store';

/** The inline, non-module script in `<head>` (DS3-R3). */
const boot = html.match(/<script>([\s\S]*?)<\/script>/)![1]!;

function run(stored: string | null | 'throw', osDark: boolean | 'throw') {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    if (stored === 'throw') throw new Error('denied');
    return stored;
  });
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => {
      if (osDark === 'throw') throw new Error('no matchMedia');
      return { matches: osDark };
    }),
  );
  new Function(boot)();
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    meta: document.querySelector('meta[name="theme-color"]')!.getAttribute('content'),
  };
}

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme');
  document.head.innerHTML = '<meta name="theme-color" content="#000000" />';
});
afterEach(() => vi.unstubAllGlobals());

describe('DS3-T3: pre-paint boot script', () => {
  it('sits in <head> before any stylesheet or module script; no class="dark"', () => {
    const head = html.slice(0, html.indexOf('</head>'));
    const at = head.indexOf('<script>');
    expect(at).toBeGreaterThan(0);
    expect(head.indexOf('rel="stylesheet"')).toBeGreaterThan(at);
    expect(html.indexOf('type="module"')).toBeGreaterThan(at);
    expect(html).not.toMatch(/class="dark"/);
  });

  it.each([
    ['light', true, 'light'],
    ['light', false, 'light'],
    ['dark', true, 'dark'],
    ['dark', false, 'dark'],
    ['system', true, 'dark'],
    ['system', false, 'light'],
    [null, true, 'dark'],
    [null, false, 'light'],
    ['garbage', false, 'light'],
    ['garbage', true, 'dark'],
    ['throw', false, 'dark'],
    ['system', 'throw', 'dark'],
  ] as const)('stored %s, OS dark %s → %s', (stored, os, expected) => {
    const r = run(stored, os);
    expect(r.theme).toBe(expected);
    expect(r.meta).toBe(THEME_COLOR[expected]);
  });

  it('uses the same meta colours as the store (= --surface-solid, theme-tokens test)', () => {
    expect(boot).toContain(`'${THEME_COLOR.light}'`);
    expect(boot).toContain(`'${THEME_COLOR.dark}'`);
  });
});
