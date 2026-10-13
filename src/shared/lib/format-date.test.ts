import { describe, expect, it } from 'vitest';
import { formatIst } from './format-date';

describe('formatIst', () => {
  it('formats a timestamp in IST as DD MMM YY | HH:mm:ss', () => {
    expect(formatIst(1788840222971)).toBe('08 Sep 26 | 09:33:42');
  });

  it('rolls over to the next IST day at UTC 18:30 (IST midnight)', () => {
    expect(formatIst(Date.UTC(2026, 0, 31, 18, 29, 59))).toBe('31 Jan 26 | 23:59:59');
    expect(formatIst(Date.UTC(2026, 0, 31, 18, 30, 0))).toBe('01 Feb 26 | 00:00:00');
  });

  it('zero-pads single-digit days, hours, minutes and seconds', () => {
    expect(formatIst(Date.UTC(2026, 2, 4, 20, 35, 7))).toBe('05 Mar 26 | 02:05:07');
  });

  it('uses three-letter month names for every month', () => {
    expect(formatIst(Date.UTC(2026, 8, 15, 6, 30))).toBe('15 Sep 26 | 12:00:00');
  });
});
