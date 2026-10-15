// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STATUS_META } from '@/features/live-tracking/config/status-meta';
import { THEME_COLOR } from '@/shared/theme/theme-colors';

const src = join(import.meta.dirname, '../..');
const THEME = 'shared/styles/theme.css';
/**
 * `color-alpha.ts` derives alpha variants at runtime; `theme-colors.ts` holds the two
 * `<meta name="theme-color">` values (checked against `--surface-solid` below).
 */
const ALLOWED = new Set([THEME, 'shared/lib/color-alpha.ts', 'shared/theme/theme-colors.ts']);
/** DS3 §3: no `\b` before `rgb(`, so `shadow-[0_30px_80px_rgb(...)]` is caught too. */
const rawColour = /#[0-9a-f]{3,8}\b|(?:rgba?|hsla?|oklch|oklab|hwb)\(/i;
const PALETTE =
  'white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const paletteClass = new RegExp(
  `(?:^|[\\s'"\`:])(?:bg|text|border|ring|fill|stroke|from|to|via|shadow|outline)-(?:${PALETTE})(?![\\w-]*-(?:solid|soft|ink|faint|muted))\\b`,
);
/** Tailwind `dark:` variants follow the OS, not our theme. */
const darkVariant = /(?:^|[\s'"`])dark:[\w[!-]/;

const files = readdirSync(src, { recursive: true, encoding: 'utf8' })
  .filter((f) => /\.(tsx?|css)$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => f.replaceAll('\\', '/'));

const theme = readFileSync(join(src, THEME), 'utf8');

/** Custom properties of the first block whose selector is exactly `selector`. */
function block(selector: string): Map<string, string> {
  const start = theme.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = theme.slice(theme.indexOf('{', start) + 1, theme.indexOf('\n}', start));
  return new Map([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}
const dark = block(':root');
const light = block(":root[data-theme='light']");

describe('DS3-T1: colours come from theme.css only', () => {
  it('scans the source tree with the tightened guards', () => {
    expect(files.length).toBeGreaterThan(30);
    expect(files).toContain(THEME);
    expect(rawColour.test('fill="#f2f2f2"')).toBe(true);
    expect(rawColour.test('shadow-[0_30px_80px_rgb(0_0_0/0.35)]')).toBe(true);
    expect(paletteClass.test("'bg-black/50 text-white'")).toBe(true);
    expect(paletteClass.test("'bg-surface-solid text-text from-tile-border'")).toBe(false);
    expect(darkVariant.test("'dark:bg-destructive/60'")).toBe(true);
    expect(darkVariant.test('  dark: import.meta.env.X,')).toBe(false);
  });

  it.each(files.filter((f) => !ALLOWED.has(f)))('%s has no raw colours or palette classes', (f) => {
    const hits = readFileSync(join(src, f), 'utf8')
      .split('\n')
      .filter((line) => rawColour.test(line) || paletteClass.test(line) || darkVariant.test(line));
    expect(hits, relative(src, f)).toEqual([]);
  });

  it('dark and light blocks define the same tokens', () => {
    const isAlias = (name: string, value: string) =>
      /^--(radius|font)/.test(name) || (value.startsWith('var(') && name !== '--marker-ring');
    const themed = [...dark].filter(([n, v]) => !isAlias(n, v)).map(([n]) => n);
    expect(themed.length).toBeGreaterThan(30);
    expect(
      themed.filter((n) => !light.has(n)),
      'missing in light',
    ).toEqual([]);
    expect(
      [...light.keys()].filter((n) => !dark.has(n)),
      'missing in dark',
    ).toEqual([]);
    for (const n of ['--scrim', '--elev-panel', '--elev-float', '--on-danger', '--marker-ring']) {
      expect(dark.has(n), n).toBe(true);
    }
  });

  it.each([
    ['running', '#4ade80', '#15803d'],
    ['stopped', '#f87171', '#dc2626'],
    ['immobilized', '#c084fc', '#9333ea'],
    ['non-comm', '#64748b', '#64748b'],
    ['charging', '#60a5fa', '#2563eb'],
    ['pullout', '#fb923c', '#c2410c'],
    ['no-gps', '#facc15', '#a16207'],
    ['gps-never', '#475569', '#7f8ca0'],
  ] as const)('STATUS_META.%s: dark %s, light %s', (status, d, l) => {
    const name = STATUS_META[status].color.match(/var\((--[\w-]+)\)/)?.[1];
    expect(name).toBeDefined();
    expect(dark.get(name!)).toBe(d);
    expect(light.get(name!)).toBe(l);
  });

  it('<meta name="theme-color"> values equal --surface-solid of each block (DS3-R3)', () => {
    expect(THEME_COLOR.dark).toBe(dark.get('--surface-solid'));
    expect(THEME_COLOR.light).toBe(light.get('--surface-solid'));
  });

  it('light accent is teal-700 (D-118)', () => {
    expect(light.get('--accent')).toBe('#0f766e');
    expect(light.get('--accent-ink')).toBe('#ffffff');
  });
});

describe('DS3-T2: Inter for text, Doto for display', () => {
  const html = readFileSync(join(src, '../index.html'), 'utf8');
  const css = readFileSync(join(src, 'index.css'), 'utf8');

  it('--font-sans starts with Inter, --font-display with Doto', () => {
    expect(dark.get('--font-sans')).toMatch(/^'Inter'/);
    expect(dark.get('--font-display')).toMatch(/^'Doto'/);
  });

  it('index.html preconnects and links Inter from Google Fonts', () => {
    expect(html).toContain('<link rel="preconnect" href="https://fonts.googleapis.com" />');
    expect(html).toMatch(/<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin/);
    expect(html).toContain(
      'https://fonts.googleapis.com/css2?family=Inter:wght@400..700&display=swap',
    );
  });

  it('Doto is trimmed to 800/900 and Inter is no npm package', () => {
    expect(css).not.toMatch(/@fontsource\/doto\/(600|700)/);
    expect(css).toMatch(/@fontsource\/doto\/800/);
    expect(css).toMatch(/@fontsource\/doto\/900/);
    const pkg = JSON.parse(readFileSync(join(src, '../package.json'), 'utf8')) as Record<
      string,
      Record<string, string> | undefined
    >;
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d) => /inter/i.test(d))).toEqual([]);
  });
});
