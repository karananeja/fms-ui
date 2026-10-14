import { describe, expect, it } from 'vitest';
import {
  epochToIstInput,
  expiryError,
  formatExpiryIst,
  istInputToEpoch,
  MAX_AHEAD_MS,
  MIN_LEAD_MS,
  resolveExpiry,
} from './share-expiry';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// 14 Oct 2026, 12:00 pm IST = 06:30 UTC.
const NOW = Date.UTC(2026, 9, 14, 6, 30);

describe('F10-T1: share-expiry', () => {
  it.each([
    ['1h', HOUR],
    ['6h', 6 * HOUR],
    ['24h', DAY],
    ['7d', 7 * DAY],
  ] as const)('preset %s → now + %d ms', (preset, ms) => {
    expect(resolveExpiry(preset, { date: '', time: '' }, NOW)).toEqual({
      expiresAt: NOW + ms,
      error: null,
    });
  });

  it('custom IST date/time ↔ epoch', () => {
    expect(istInputToEpoch({ date: '2026-10-15', time: '18:30' })).toBe(
      Date.UTC(2026, 9, 15, 13, 0),
    );
    expect(epochToIstInput(Date.UTC(2026, 9, 15, 13, 0))).toEqual({
      date: '2026-10-15',
      time: '18:30',
    });
    // IST midnight is the previous UTC day.
    expect(epochToIstInput(Date.UTC(2026, 9, 14, 18, 45))).toEqual({
      date: '2026-10-15',
      time: '00:15',
    });
  });

  it('round trip keeps the minute', () => {
    for (const at of [NOW, NOW + 7 * DAY + 17 * MIN, Date.UTC(2026, 11, 31, 20, 59)]) {
      expect(istInputToEpoch(epochToIstInput(at))).toBe(at);
    }
  });

  it('rejects malformed or impossible inputs', () => {
    expect(istInputToEpoch({ date: '', time: '10:00' })).toBeNull();
    expect(istInputToEpoch({ date: '2026-10-15', time: '' })).toBeNull();
    expect(istInputToEpoch({ date: '2026-02-31', time: '10:00' })).toBeNull();
    expect(istInputToEpoch({ date: '2026-10-15', time: '24:00' })).toBeNull();
  });

  it('custom must be ≥ 5 min ahead and ≤ 30 days ahead', () => {
    expect(expiryError(NOW + MIN_LEAD_MS - 1, NOW)).toBe('Pick a time at least 5 min from now.');
    expect(expiryError(NOW - HOUR, NOW)).toBe('Pick a time at least 5 min from now.');
    expect(expiryError(NOW + MIN_LEAD_MS, NOW)).toBeNull();
    expect(expiryError(NOW + MAX_AHEAD_MS, NOW)).toBeNull();
    expect(expiryError(NOW + MAX_AHEAD_MS + 1, NOW)).toBe('Links can last at most 30 days.');

    // 12:04 pm IST is < 5 min ahead; 31 days is too far; 12:05 pm is fine.
    expect(resolveExpiry('custom', { date: '2026-10-14', time: '12:04' }, NOW).error).toMatch(
      /5 min/,
    );
    expect(resolveExpiry('custom', { date: '2026-11-14', time: '12:01' }, NOW).error).toMatch(
      /30 days/,
    );
    expect(resolveExpiry('custom', { date: '2026-10-14', time: '12:05' }, NOW)).toEqual({
      expiresAt: NOW + 5 * MIN,
      error: null,
    });
    expect(resolveExpiry('custom', { date: '', time: '' }, NOW).error).toBe(
      'Enter a date and time.',
    );
  });

  it('formats the resolved expiry in IST', () => {
    expect(formatExpiryIst(Date.UTC(2026, 9, 15, 13, 0))).toBe('15 Oct, 6:30 pm IST');
    expect(formatExpiryIst(Date.UTC(2026, 9, 14, 18, 45))).toBe('15 Oct, 12:15 am IST');
  });
});
