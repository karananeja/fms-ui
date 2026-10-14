import type { RedactedCombinfo } from '@shared/contract/payloads.ts';
import { describe, expect, it } from 'vitest';
import type { TrailPoint } from './public-share-api';
import { formatIstShort, formatTimeLeft } from './share-format';
import { appendTrail, isMoving } from './share-live-model';
import { combinfo } from './testing/fake-share-socket';

const c = (t: number, extra: Record<string, unknown> = {}) =>
  combinfo(t, extra) as unknown as RedactedCombinfo;

describe('F10-T4: share live model', () => {
  it('moving uses speed when shown, else the position change (> 5 m)', () => {
    expect(isMoving(null, c(1, { speed: 12 }))).toBe(true);
    expect(isMoving(null, c(1, { speed: 0 }))).toBe(false);
    const a = c(1000, { latitude: 12.97, longitude: 77.59 });
    expect(isMoving(a, c(2000, { latitude: 12.97, longitude: 77.59 }))).toBe(false);
    expect(isMoving(a, c(2000, { latitude: 12.9702, longitude: 77.59 }))).toBe(true);
    expect(isMoving(null, a)).toBeNull();
  });

  it('trail appends newer points only and trims to the window', () => {
    const t: TrailPoint[] = [
      [1, 1, 0],
      [2, 2, 30_000],
      [3, 3, 60_000],
    ];
    expect(appendTrail(t, [9, 9, 60_000], 60_000)).toBe(t);
    expect(appendTrail(t, [4, 4, 90_000], 60_000)).toEqual([
      [2, 2, 30_000],
      [3, 3, 60_000],
      [4, 4, 90_000],
    ]);
  });

  it('formats expiry in IST', () => {
    const at = Date.UTC(2026, 9, 15, 13, 0);
    expect(formatIstShort(at)).toBe('15 Oct, 6:30 pm IST');
    expect(formatTimeLeft(at, at - 5 * 3600_000 - 1)).toBe('in 5 h');
    expect(formatTimeLeft(at, at - 23 * 60_000)).toBe('in 23 min');
    expect(formatTimeLeft(at, at - 119 * 60_000 - 1)).toBe('in 1 h 59 min');
    expect(formatTimeLeft(at, at - 20 * 3600_000)).toBe('in 20 h');
    expect(formatTimeLeft(at, at - 3 * 86_400_000)).toBe('in 3 d');
    expect(formatTimeLeft(at, at + 1)).toBe('now');
  });
});
