import type { Assignment, Driver } from '@shared/contract/index.ts';
import { describe, expect, it, vi } from 'vitest';
import { DriverIndex, DriverSearch, namePrefixMatch, type DriverIndexRow } from './driver-index.ts';

const assignment = (driverId: string, vehicleId: string, to: number | null = null): Assignment => ({
  id: `a-${driverId}-${vehicleId}`,
  driverId,
  vehicleId,
  from: 1,
  to,
  by: 'u-1',
});

const driver = (id: string, name: string): Driver => ({
  id,
  userId: null,
  name,
  phone: '+91 98765 43210',
  fleetId: 'f1',
  status: 'active',
  createdAt: 0,
});

describe('F12-T1: worker driver index (D-095)', () => {
  it('matches the start of the name or of any word, case-insensitively', () => {
    expect(namePrefixMatch('RAVI KUMAR', 'RA')).toBe(true);
    expect(namePrefixMatch('RAVI KUMAR', 'KUM')).toBe(true);
    expect(namePrefixMatch('RAVI KUMAR', 'AVI')).toBe(false);

    const index = new DriverIndex();
    index.load([
      ['v1', 'd1', 'Ravi Kumar'],
      ['v2', 'd2', 'Kumar Sanu'],
      ['v3', 'd3', 'Anita Rao'],
    ]);
    expect(index.size).toBe(3);
    // Full-name prefix matches rank first.
    expect(index.match('kum', 8).map((m) => m.vehicleId)).toEqual(['v2', 'v1']);
    expect(index.match('ra', 8).map((m) => m.name)).toEqual(['Ravi Kumar', 'Anita Rao']);
    expect(index.match('ra', 1)).toHaveLength(1);
    expect(index.match('ra', 8, (id) => id !== 'v1').map((m) => m.vehicleId)).toEqual(['v3']);
    expect(index.match('  ', 8)).toEqual([]);
  });

  it('applies assignment events: moves a known driver, removes on unassign', () => {
    const index = new DriverIndex();
    index.load([['v1', 'd1', 'Ravi Kumar']]);

    // Reassign d1 to v2: v1 loses its entry.
    expect(index.apply(assignment('d1', 'v2'))).toBe(true);
    expect(index.driverOf('v1')).toBeNull();
    expect(index.driverOf('v2')?.name).toBe('Ravi Kumar');

    // An old (closed) assignment of another vehicle doesn't touch v2.
    expect(index.apply(assignment('d1', 'v1', 5))).toBe(true);
    expect(index.has('v2')).toBe(true);

    // Unassign: closed assignment of the current pair.
    expect(index.apply(assignment('d1', 'v2', 9))).toBe(true);
    expect(index.has('v2')).toBe(false);
    expect(index.match('ravi', 8)).toEqual([]);

    // The name is remembered for a later assignment.
    expect(index.apply(assignment('d1', 'v3'))).toBe(true);
    expect(index.driverOf('v3')?.driverId).toBe('d1');
  });

  it('a new driver on a vehicle replaces the previous one; an unknown name asks the caller', () => {
    const index = new DriverIndex();
    index.load([['v1', 'd1', 'Ravi Kumar']]);
    expect(index.apply(assignment('d9', 'v1'))).toBe(false);
    expect(index.has('v1')).toBe(false);
    index.set('v1', 'd9', 'Zoya Khan');
    expect(index.match('zo', 8).map((m) => m.vehicleId)).toEqual(['v1']);
  });

  it('DriverSearch fills from the server once per prefix and names new assignments', async () => {
    const fetchJson = vi.fn(async (path: string) => {
      if (path.startsWith('/api/vehicles?driver='))
        return { items: [{ vehicleId: 'v1' }, { vehicleId: 'v2' }], nextCursor: null };
      if (path === '/api/vehicles/v1/driver') return driver('d1', 'Ravi Kumar');
      if (path === '/api/vehicles/v2/driver') return driver('d2', 'Ravina Shah');
      if (path === '/api/vehicles/v5/driver') return driver('d5', 'Rahul Dev');
      throw new Error(`unexpected ${path}`);
    });
    const search = new DriverSearch(new DriverIndex(), fetchJson);
    const known = (id: string) => id !== 'v2';

    await search.fill('Rav', known);
    expect(search.index.match('rav', 8, known).map((m) => m.name)).toEqual(['Ravi Kumar']);
    const calls = fetchJson.mock.calls.length;
    await search.fill('rav', known);
    expect(fetchJson.mock.calls.length).toBe(calls);

    await search.apply(assignment('d5', 'v5'));
    expect(search.index.driverOf('v5')?.name).toBe('Rahul Dev');

    search.reset();
    await search.fill('rav', known);
    expect(fetchJson.mock.calls.length).toBeGreaterThan(calls);
  });

  it('budget: builds 1 lakh rows within 150 ms and matches within 100 ms', () => {
    const first = ['Ravi', 'Anita', 'Suresh', 'Priya', 'Arjun', 'Kavya', 'Mohan', 'Zoya'];
    const last = ['Kumar', 'Rao', 'Shah', 'Iyer', 'Singh', 'Das', 'Nair', 'Khan'];
    const rows: DriverIndexRow[] = Array.from({ length: 100_000 }, (_, i) => [
      `v${i}`,
      `d${i}`,
      `${first[i % 8]} ${last[(i >> 3) % 8]} ${i}`,
    ]);
    const index = new DriverIndex();
    index.load(rows);
    expect(index.size).toBe(100_000);
    expect(index.buildMs).toBeLessThan(150);
    expect(index.match('kav', 8)).toHaveLength(8);
    expect(index.matchMs).toBeLessThan(100);
  });
});
