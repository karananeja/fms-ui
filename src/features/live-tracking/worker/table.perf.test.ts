// @vitest-environment node
import { COMBINFO_SNAPSHOT_FIELDS } from '@shared/contract/ws-protocol.ts';
import { describe, expect, it } from 'vitest';
import { INDIA_CITIES } from '../config/india-cities.ts';
import { statusLafPids, statusRulesConfig } from '../config/status-rules-config.ts';
import { TABLE_COLUMN_IDS, type TableColumnId } from '../config/table-columns.ts';
import { exportCsv } from './csv-exporter.ts';
import { FleetState } from './fleet-state.ts';
import { StatusTracker } from './status-deriver.ts';
import { TableQueryEngine } from './table-query.ts';
import { BASE_T, snapshotRow } from './testing/fake-socket.ts';
import { trayQuery } from './tray-query.ts';

const VEHICLES = 100_000;

function lakh() {
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const state = new FleetState({ pids: statusLafPids(statusRulesConfig), capacity: VEHICLES });
  const status = new StatusTracker(state, statusRulesConfig);
  status.now = BASE_T;
  state.applyCombinfo(
    COMBINFO_SNAPSHOT_FIELDS,
    Array.from({ length: VEHICLES }, (_, i) => {
      const [w, s, e, n] = INDIA_CITIES[i % INDIA_CITIES.length]!.bbox;
      return snapshotRow(i, {
        regno: `KA${String(i % 99).padStart(2, '0')}${String.fromCharCode(65 + (i % 26))}${String(Math.floor(rnd() * 1e6)).padStart(6, '0')}`,
        fleetId: `f${i % 40}`,
        lat: w === undefined ? 0 : s + rnd() * (n - s),
        lng: e === undefined ? 0 : w + rnd() * (e - w),
        soc: Math.floor(rnd() * 101),
        speed: i % 3 ? 0 : Math.floor(rnd() * 80),
        odometer: rnd() * 1e5,
        utctime: BASE_T - Math.floor(rnd() * 600_000),
      });
    }),
  );
  return state;
}

const time = async (fn: () => unknown) => {
  const t0 = performance.now();
  await fn();
  return performance.now() - t0;
};

describe('F09-T3: table, CSV and tray at 1 lakh vehicles', () => {
  it('window query ≤ 30 ms, export ≤ 5 s, tray ≤ 10 ms', { timeout: 60_000 }, async () => {
    const state = lakh();
    let now = 0;
    let extra = 0;
    const table = new TableQueryEngine(
      state,
      () => true,
      () => state.version + extra,
      () => now,
    );
    table.setFleetNames(
      Object.fromEntries(Array.from({ length: 40 }, (_, k) => [`f${k}`, `Fleet ${k}`])),
    );

    // Sort (cache build) per column type, then the window queries the table actually makes.
    const sorts: Record<string, number> = {};
    for (const column of [
      'regno',
      'fleet',
      'status',
      'soc',
      'gpstime',
      'location',
    ] as TableColumnId[]) {
      extra++;
      now += 2000;
      sorts[column] = await time(() =>
        table.query({ scope: 'all', sort: { column, dir: 'asc' }, offset: 0, limit: 100 }),
      );
    }
    const q = {
      scope: 'all' as const,
      sort: { column: 'soc' as TableColumnId, dir: 'desc' as const },
    };
    table.query({ ...q, offset: 0, limit: 100 });
    const windows = await Promise.all(
      [0, 25_000, 50_000, 99_900].map((offset) =>
        time(() => table.query({ ...q, offset, limit: 100 })),
      ),
    );
    const vp = INDIA_CITIES.find((c) => c.name === 'Pune')!.bbox;
    extra++;
    now += 2000;
    const viewportSort = await time(() =>
      table.query({ scope: 'viewport', bbox: vp, sort: q.sort, offset: 0, limit: 100 }),
    );
    const viewportTotal = table.query({
      scope: 'viewport',
      bbox: vp,
      sort: q.sort,
      offset: 0,
      limit: 1,
    }).total;

    let rows = 0;
    let bytes = 0;
    const exportMs = await time(async () => {
      const r = await exportCsv(
        { ...q, columns: [...TABLE_COLUMN_IDS] },
        state,
        table,
        {},
        () => {},
      );
      rows = r.rows;
      bytes = r.blob.size;
    });

    const india: [number, number, number, number] = [68, 6, 98, 36];
    const tray = {
      india: await time(() => trayQuery(state, () => true, statusRulesConfig.priority, india)),
      pune: await time(() => trayQuery(state, () => true, statusRulesConfig.priority, vp)),
    };

    console.log(
      `[F09-T3] sort (cache build, ≤ 1/s while live): ${Object.entries(sorts)
        .map(([k, v]) => `${k} ${v.toFixed(1)}`)
        .join(', ')} ms; ` +
        `window (cached order) ${windows.map((w) => w.toFixed(2)).join('/')} ms; viewport sort ${viewportSort.toFixed(1)} ms (${viewportTotal} rows); ` +
        `export ${rows} rows × ${TABLE_COLUMN_IDS.length} cols ${(exportMs / 1000).toFixed(2)} s (${(bytes / 1e6).toFixed(1)} MB); ` +
        `tray india ${tray.india.toFixed(2)} ms, pune ${tray.pune.toFixed(2)} ms`,
    );

    for (const w of windows) expect(w).toBeLessThanOrEqual(30);
    expect(rows).toBe(VEHICLES);
    expect(exportMs).toBeLessThanOrEqual(5000);
    expect(Math.max(tray.india, tray.pune)).toBeLessThanOrEqual(10);
    // Reported, not asserted: a full re-sort runs at most once per second (F09-R3).
    expect(Math.max(...Object.values(sorts))).toBeLessThan(1000);
  });
});
