// @vitest-environment node
import { COMBINFO_LEAVE_FIELDS, COMBINFO_SNAPSHOT_FIELDS } from '@shared/contract/ws-protocol.ts';
import { describe, expect, it } from 'vitest';
import { statusLafPids, statusRulesConfig } from '../config/status-rules-config.ts';
import { FilterEngine, type VehicleFilter } from './filter-engine.ts';
import { FleetState } from './fleet-state.ts';
import { SearchIndex } from './search-index.ts';
import { StatusTracker } from './status-deriver.ts';
import { BASE_T, snapshotRow } from './testing/fake-socket.ts';

const VEHICLES = 100_000;
const FLEETS = Array.from({ length: 40 }, (_, k) => ({
  id: `f${k}`,
  parentId: k < 4 ? null : `f${k % 4}`,
}));
const STATES = ['KA', 'MH', 'DL', 'TN', 'GJ', 'UP', 'WB', 'TS'];

function lakh(withSearch = true) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const state = new FleetState({ pids: statusLafPids(statusRulesConfig), capacity: VEHICLES });
  const status = new StatusTracker(state, statusRulesConfig);
  status.now = BASE_T;
  const filters = new FilterEngine(state);
  filters.setFleets(FLEETS);
  const tasks: (() => void)[] = [];
  const search = withSearch ? new SearchIndex(state, (t) => tasks.push(t)) : null!;
  const rows = Array.from({ length: VEHICLES }, (_, i) => {
    const st = STATES[i % STATES.length]!;
    const series = String.fromCharCode(65 + (i % 26), 65 + ((i >> 5) % 26));
    return snapshotRow(i, {
      fleetId: `f${i % 40}`,
      regno: `${st}${String(i % 99).padStart(2, '0')}${series}${String(i % 10_000).padStart(4, '0')}`,
      vin: `MA${Math.floor(rnd() * 36 ** 6)
        .toString(36)
        .toUpperCase()}${i}`,
      deviceId: `86${String(1e9 + i)}`,
      assetType: ['Bus', 'Car', '3W', 'Truck'][i % 4],
      fuelType: i % 5 ? 'Electric' : 'CNG',
      make: ['Tata', 'Mahindra', 'Ola', 'Ather'][i % 4],
      model: `M${i % 12}`,
      soc: Math.floor(rnd() * 101),
      speed: i % 3 ? 0 : 25,
    });
  });
  state.applyCombinfo(COMBINFO_SNAPSHOT_FIELDS, rows);
  /** The worker's next tasks (the engine schedules rebuilds with a 0 ms timer). */
  const idle = () => tasks.splice(0).forEach((t) => t());
  return { state, filters, search, rows, idle };
}

const time = (fn: () => unknown) => {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
};
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

describe('F08-T3: filter and search at 1 lakh vehicles', () => {
  it('filter apply ≤ 100 ms, suggestion ≤ 50 ms (cold and warm)', { timeout: 30_000 }, () => {
    const { state, filters, search, rows, idle } = lakh();
    expect(state.count).toBe(VEHICLES);

    const cases: [string, VehicleFilter][] = [
      ['statuses only', { statuses: ['running', 'charging'] }],
      ['fleet subtree', { fleetIds: ['f1'] }],
      [
        'types + make + model',
        {
          assetTypes: ['Bus', 'Car'],
          fuelTypes: ['Electric'],
          makes: ['Tata'],
          models: ['M0', 'M4'],
        },
      ],
      ['soc range', { socMin: 20, socMax: 60 }],
      ['search all', { search: { field: 'all', prefix: 'ka0' } }],
      [
        'everything',
        {
          fleetIds: ['f2'],
          assetTypes: ['3W'],
          socMin: 10,
          search: { field: 'regno', prefix: 'TN' },
        },
      ],
      ['clear', {}],
    ];
    const apply = cases.map(([name, f]) => {
      const runs = [0, 1, 2].map(() => (filters.set(f), filters.setMs));
      return { name, ms: Math.max(...runs), matches: filters.matchCount };
    });
    const countsMs = time(() => filters.set(cases[5]![1]) ?? filters.counts());

    // Full build (runs once, when the snapshot completes — `engine.search.warm()`).
    search.warm();
    const fullBuild = search.buildMs;

    // Queries right after the fleet changed: the index is updated in place, not rebuilt.
    const afterChange = (
      label: string,
      change: () => void,
      p: string,
      f: Parameters<SearchIndex['suggest']>[1],
    ) => {
      change();
      idle();
      const ms = time(() => search.suggest(p, f));
      return { label, ms, n: search.suggest(p, f).length };
    };
    const changes = [
      afterChange(
        'after add',
        () =>
          state.applyCombinfo(COMBINFO_SNAPSHOT_FIELDS, [
            snapshotRow(VEHICLES, { regno: 'KA99ZZ0001' }),
          ]),
        'KA99ZZ',
        'all',
      ),
      afterChange(
        'after remove',
        () => state.applyCombinfo(COMBINFO_LEAVE_FIELDS, [[`v${VEHICLES}`, null]]),
        'KA99ZZ',
        'all',
      ),
      afterChange(
        'after id change',
        () =>
          state.applyCombinfo(COMBINFO_SNAPSHOT_FIELDS, [snapshotRow(5, { regno: 'MH99XX0005' })]),
        'MH99XX',
        'regno',
      ),
      afterChange(
        'after 500 adds',
        () =>
          state.applyCombinfo(
            COMBINFO_SNAPSHOT_FIELDS,
            Array.from({ length: 500 }, (_, k) =>
              snapshotRow(VEHICLES + 1 + k, { regno: `GJ77QQ${String(k).padStart(4, '0')}` }),
            ),
          ),
        'GJ77QQ',
        'regno',
      ),
    ];
    const rebuildsAfterChanges = search.builds;

    const prefixes: [string, Parameters<SearchIndex['suggest']>[1]][] = [
      ['KA0', 'all'],
      ['MH12', 'regno'],
      ['MA1', 'vin'],
      ['861000', 'deviceId'],
      ['z', 'all'],
    ];
    const warm = prefixes.map(([p, f]) => {
      const runs = Array.from({ length: 20 }, () => time(() => search.suggest(p, f)));
      return { p, f, ms: median(runs), max: Math.max(...runs), n: search.suggest(p, f).length };
    });

    // 1 Hz re-apply of every row with unchanged identifiers: the index's per-row check cost.
    const reapply = () => state.applyCombinfo(COMBINFO_SNAPSHOT_FIELDS, rows);
    const withIndex = median([0, 1, 2].map(() => time(reapply)));
    const bare = lakh(false);
    const withoutIndex = median(
      [0, 1, 2].map(() =>
        time(() => bare.state.applyCombinfo(COMBINFO_SNAPSHOT_FIELDS, bare.rows)),
      ),
    );

    const report = [
      `apply ${apply.map((a) => `${a.name}: ${a.ms.toFixed(1)} ms (${a.matches})`).join('; ')}`,
      `counts after filter ${countsMs.toFixed(1)} ms`,
      `search index full build (off the query path) ${fullBuild.toFixed(1)} ms`,
      `search after change ${changes.map((c) => `${c.label}: ${c.ms.toFixed(2)} ms (${c.n})`).join('; ')}; full rebuilds ${rebuildsAfterChanges}`,
      `search warm ${warm.map((w) => `${w.f} "${w.p}": median ${w.ms.toFixed(2)} / max ${w.max.toFixed(2)} ms (${w.n})`).join('; ')}`,
      `re-apply 1 lakh unchanged rows: ${withIndex.toFixed(1)} ms with the index, ${withoutIndex.toFixed(1)} ms without`,
    ].join('\n');
    console.log(`[F08-T3]\n${report}`);

    for (const a of apply) expect(a.ms, a.name).toBeLessThanOrEqual(100);
    for (const w of warm) expect(w.max, `${w.f} ${w.p}`).toBeLessThanOrEqual(50);
    for (const c of changes) expect(c.ms, c.label).toBeLessThanOrEqual(50);
    expect(changes.map((c) => c.n)).toEqual([1, 0, 1, 8]);
    // Single changes are spliced in place; the 500-vehicle burst triggers one scheduled rebuild.
    expect(rebuildsAfterChanges).toBe(2);
  });
});
