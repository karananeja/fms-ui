// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = import.meta.dirname;
const reactImport =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"](react|react-dom)(\/[^'"]*)?['"]/;

const sources = [
  join(root, 'store/live-tracking-store.ts'),
  ...readdirSync(join(root, 'worker'), { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => join(root, 'worker', f)),
];

describe('F04-T7 / F04-R20: no React in the store or the worker', () => {
  it('scans the expected files', () => {
    expect(sources.length).toBeGreaterThanOrEqual(6);
    expect(reactImport.test("import { useMemo } from 'react';")).toBe(true);
    expect(reactImport.test("import 'react-dom/client';")).toBe(true);
  });

  it.each(sources.map((f) => [f.slice(root.length + 1), f]))(
    '%s has no react imports',
    (_, file) => {
      expect(readFileSync(file, 'utf8')).not.toMatch(reactImport);
    },
  );
});
