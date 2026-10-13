// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CENTRES } from '../../../../mock-server/generator/catalogue.ts';
import { INDIA_CITIES } from './india-cities.ts';

describe('F06-R18: india-cities matches the mock generator', () => {
  it('has the same 40 cities (name + state), sorted A–Z', () => {
    const key = (c: { name: string; state: string }) => `${c.name}|${c.state}`;
    expect(INDIA_CITIES.map(key).sort()).toEqual(CENTRES.map(key).sort());
    expect(INDIA_CITIES).toHaveLength(40);
    const names = INDIA_CITIES.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('each bbox contains its generator centre', () => {
    for (const c of CENTRES) {
      const [w, s, e, n] = INDIA_CITIES.find((x) => x.name === c.name)!.bbox;
      expect(c.lng > w && c.lng < e && c.lat > s && c.lat < n, c.name).toBe(true);
    }
  });
});
