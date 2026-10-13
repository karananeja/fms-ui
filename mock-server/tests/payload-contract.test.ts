// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import combinfoFixture from '../fixtures/combinfo-sample.json' with { type: 'json' };
import lafparsedFixture from '../fixtures/lafparsed-sample.json' with { type: 'json' };
import { combinfoSchema, lafparsedSchema, passwordSchema } from '@shared/contract/index.ts';

const md = (file: string) =>
  JSON.parse(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'));

describe('contract', () => {
  it('fixtures are exact copies of caninfo.md / lafparsed.md and parse with the payload schemas', () => {
    expect(combinfoFixture).toEqual(md('caninfo.md'));
    expect(lafparsedFixture).toEqual(md('lafparsed.md'));
    expect(Object.keys(lafparsedFixture.candata)).toHaveLength(374);
    expect(combinfoSchema.safeParse(combinfoFixture).success).toBe(true);
    expect(lafparsedSchema.safeParse(lafparsedFixture).success).toBe(true);
  });

  it('password policy (D-018): ≥ 8 chars, ≥ 1 letter, ≥ 1 number', () => {
    for (const ok of ['Admin@123', 'abcdefg1', '1234567a'])
      expect(passwordSchema.safeParse(ok).success).toBe(true);
    for (const bad of ['short1A', 'abcdefgh', '12345678', ''])
      expect(passwordSchema.safeParse(bad).success).toBe(false);
  });
});
