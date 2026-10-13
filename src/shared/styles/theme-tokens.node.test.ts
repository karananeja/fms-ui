// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STATUS_META } from '@/features/live-tracking/config/status-meta';

const src = join(import.meta.dirname, '../..');
const THEME = 'shared/styles/theme.css';
const rawColour = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|hwb)\(/i;

const files = readdirSync(src, { recursive: true, encoding: 'utf8' })
  .filter((f) => /\.(tsx?|css)$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => f.replaceAll('\\', '/'));

const theme = readFileSync(join(src, THEME), 'utf8');
const tokenValue = (name: string) => theme.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]?.trim();

describe('DS1-T1: colours come from theme.css only', () => {
  it('scans the source tree', () => {
    expect(files.length).toBeGreaterThan(30);
    expect(files).toContain(THEME);
    expect(rawColour.test('fill="#f2f2f2"')).toBe(true);
    expect(rawColour.test('rgb(0 0 0 / 0.4)')).toBe(true);
  });

  it.each(files.filter((f) => f !== THEME))('%s has no raw colour literals', (file) => {
    const hits = readFileSync(join(src, file), 'utf8')
      .split('\n')
      .filter((line) => rawColour.test(line));
    expect(hits, relative(src, file)).toEqual([]);
  });

  it.each([
    ['running', '#4ade80'],
    ['stopped', '#f87171'],
    ['immobilized', '#c084fc'],
    ['non-comm', '#64748b'],
    ['charging', '#60a5fa'],
    ['pullout', '#fb923c'],
    ['no-gps', '#facc15'],
    ['gps-never', '#475569'],
  ] as const)('STATUS_META.%s resolves to %s', (status, hex) => {
    const name = STATUS_META[status].color.match(/var\((--[\w-]+)\)/)?.[1];
    expect(name).toBeDefined();
    expect(tokenValue(name!)).toBe(hex);
  });
});

describe('DS1-T2: Doto is the only font', () => {
  it('Inter is not a dependency or import', () => {
    const pkg = readFileSync(join(src, '../package.json'), 'utf8');
    expect(pkg).not.toMatch(/inter/i);
    for (const f of files) expect(readFileSync(join(src, f), 'utf8')).not.toMatch(/\bInter\b/);
  });

  it('--font-sans starts with Doto', () => {
    expect(tokenValue('--font-sans')).toMatch(/^'Doto'/);
  });
});
