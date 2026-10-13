// @vitest-environment node
import { COMBINFO_LEAVE_FIELDS, COMBINFO_SNAPSHOT_FIELDS } from '@shared/contract/ws-protocol.ts';
import { describe, expect, it } from 'vitest';
import { statusLafPids, statusRulesConfig } from '../config/status-rules-config.ts';
import {
  cellText,
  TABLE_COLUMN_IDS,
  type TableColumnId,
  type TableRow,
} from '../config/table-columns.ts';
import { exportCsv, csvField } from './csv-exporter.ts';
import { FleetState } from './fleet-state.ts';
import { StatusTracker } from './status-deriver.ts';
import { RESORT_MS, TableQueryEngine } from './table-query.ts';
import { BASE_T, snapshotRow } from './testing/fake-socket.ts';
import { trayQuery } from './tray-query.ts';

const NAMES = { f0: 'North', f1: 'South' };

/** 6 vehicles with hand-picked values; v5 has no fix and no SOC. */
const VEHICLES: Record<string, unknown>[] = [
  {
    regno: 'KA01AB0003',
    soc: 50,
    speed: 30,
    odometer: 100.9,
    ignstatus: 1,
    lat: 12.9,
    lng: 77.6,
    utctime: BASE_T,
  },
  {
    regno: 'KA01AB0001',
    soc: 80,
    speed: 0,
    odometer: 50,
    ignstatus: 0,
    lat: 12.8,
    lng: 77.7,
    utctime: BASE_T - 1000,
  },
  {
    regno: 'ka01ab0002',
    soc: 50,
    speed: 0,
    odometer: 70,
    ignstatus: 0,
    lat: 12.9,
    lng: 77.5,
    utctime: BASE_T - 2000,
  },
  {
    regno: 'MH12, "X"\nY',
    soc: 10,
    speed: 45,
    odometer: 10,
    ignstatus: 1,
    lat: 19.0,
    lng: 72.8,
    utctime: BASE_T,
  },
  {
    regno: 'DL01AA0004',
    soc: 95,
    speed: 0,
    odometer: 900,
    ignstatus: 0,
    lat: 28.6,
    lng: 77.2,
    utctime: BASE_T - 500,
  },
  {
    regno: 'TN01ZZ0005',
    soc: null,
    speed: 0,
    odometer: 5,
    ignstatus: -1,
    lat: 0,
    lng: 0,
    utctime: BASE_T,
  },
];

function setup(match: (vehicleId: string) => boolean = () => true) {
  const state = new FleetState({ pids: statusLafPids(statusRulesConfig) });
  const tracker = new StatusTracker(state, statusRulesConfig);
  tracker.now = BASE_T;
  state.applyCombinfo(
    COMBINFO_SNAPSHOT_FIELDS,
    VEHICLES.map((v, n) => snapshotRow(n, { ...v, gpstime: v.utctime })),
  );
  const clock = { t: 0, extra: 0 };
  const table = new TableQueryEngine(
    state,
    (i) => match(state.str.vehicleId[i]!),
    () => state.version + clock.extra,
    () => clock.t,
  );
  table.setFleetNames(NAMES);
  const order = (
    column: TableColumnId,
    dir: 'asc' | 'desc' = 'asc',
    scope: 'all' | 'viewport' = 'all',
    bbox?: [number, number, number, number],
  ) =>
    table
      .query({ scope, bbox, sort: { column, dir }, offset: 0, limit: 200 })
      .rows.map((r) => r.vehicleId);
  return { state, table, clock, order };
}

describe('F09-T1: table-query', () => {
  it('sorts strings case-insensitively, both directions, ties by vehicle id', () => {
    const { order } = setup();
    expect(order('regno')).toEqual(['v4', 'v1', 'v2', 'v0', 'v3', 'v5']);
    expect(order('regno', 'desc')).toEqual(['v5', 'v3', 'v0', 'v2', 'v1', 'v4']);
    // Fleet sorts by name: North (even ids) before South (odd ids).
    expect(order('fleet')).toEqual(['v0', 'v2', 'v4', 'v1', 'v3', 'v5']);
  });

  it('sorts numbers with missing values last in both directions; equal values stay in id order', () => {
    const { order } = setup();
    expect(order('soc')).toEqual(['v3', 'v0', 'v2', 'v1', 'v4', 'v5']);
    expect(order('soc', 'desc')).toEqual(['v4', 'v1', 'v0', 'v2', 'v3', 'v5']);
    expect(order('ignition')).toEqual(['v1', 'v2', 'v4', 'v0', 'v3', 'v5']);
    expect(order('location')).toEqual(['v1', 'v2', 'v0', 'v3', 'v4', 'v5']);
    expect(order('status')).toEqual(['v0', 'v3', 'v1', 'v2', 'v4', 'v5']);
  });

  it('windows with offset and limit (≤ 200) and reports the total', () => {
    const { table } = setup();
    const r = table.query({
      scope: 'all',
      sort: { column: 'regno', dir: 'asc' },
      offset: 2,
      limit: 3,
    });
    expect(r.total).toBe(6);
    expect(r.rows.map((x) => x.vehicleId)).toEqual(['v2', 'v0', 'v3']);
    expect(
      table.query({ scope: 'all', sort: { column: 'regno', dir: 'asc' }, offset: 0, limit: 999 })
        .rows,
    ).toHaveLength(6);
  });

  it('viewport scope keeps vehicles with a fix inside the bbox', () => {
    const { order } = setup();
    expect(order('regno', 'asc', 'viewport', [77, 12, 78, 13])).toEqual(['v1', 'v2', 'v0']);
    expect(order('regno', 'asc', 'viewport')).toEqual([]);
  });

  it('iterates only matching vehicles', () => {
    const { order } = setup((id) => id !== 'v1' && id !== 'v4');
    expect(order('regno')).toEqual(['v2', 'v0', 'v3', 'v5']);
  });

  it('rows carry plain values (null for missing)', () => {
    const { table } = setup();
    const [v5] = table.query({
      scope: 'all',
      sort: { column: 'regno', dir: 'desc' },
      offset: 0,
      limit: 1,
    }).rows;
    expect(v5).toMatchObject({
      vehicleId: 'v5',
      soc: null,
      ignition: null,
      lat: null,
      lng: null,
      fleetId: 'f1',
    });
  });

  it('re-sorts when the data changes, at most every RESORT_MS; version follows', () => {
    const { state, table, clock } = setup();
    const q = {
      scope: 'all' as const,
      sort: { column: 'soc' as const, dir: 'asc' as const },
      offset: 0,
      limit: 10,
    };
    const first = table.query(q);
    expect(table.sorts).toBe(1);
    state.applyCombinfo(COMBINFO_SNAPSHOT_FIELDS, [snapshotRow(4, { ...VEHICLES[4], soc: 1 })]);
    clock.t += RESORT_MS - 1;
    const cached = table.query(q);
    expect(table.sorts).toBe(1);
    expect(cached.version).toBe(first.version);
    // Rows are read live even from the cached order.
    expect(cached.rows.find((r) => r.vehicleId === 'v4')!.soc).toBe(1);
    clock.t += 1;
    const fresh = table.query(q);
    expect(table.sorts).toBe(2);
    expect(fresh.version).toBeGreaterThan(first.version);
    expect(fresh.rows[0]!.vehicleId).toBe('v4');
    // A sort change rebuilds at once.
    table.query({ ...q, sort: { column: 'soc', dir: 'desc' } });
    expect(table.sorts).toBe(3);
  });

  it('skips vehicles removed since the order was built', () => {
    const { state, table } = setup();
    const q = {
      scope: 'all' as const,
      sort: { column: 'regno' as const, dir: 'asc' as const },
      offset: 0,
      limit: 10,
    };
    table.query(q);
    state.applyCombinfo(COMBINFO_LEAVE_FIELDS, [['v1', null]]);
    expect(table.query(q).rows.map((r) => r.vehicleId)).toEqual(['v4', 'v2', 'v0', 'v3', 'v5']);
  });
});

describe('F09-T2: csv-exporter', () => {
  const parse = async (blob: Blob) => {
    // Minimal RFC 4180 reader for the assertions.
    const text = await blob.text();
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let quoted = false;
    for (let k = 0; k < text.length; k++) {
      const c = text[k]!;
      if (quoted) {
        if (c === '"' && text[k + 1] === '"') ((cell += '"'), k++);
        else if (c === '"') quoted = false;
        else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') (row.push(cell), (cell = ''));
      else if (c === '\r' && text[k + 1] === '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
        k++;
      } else cell += c;
    }
    return rows;
  };

  it('header + rows equal the table for the same scope, sort and columns', async () => {
    const { state, table } = setup();
    const columns: TableColumnId[] = [
      'regno',
      'fleet',
      'status',
      'soc',
      'odometer',
      'ignition',
      'gpstime',
      'location',
    ];
    const sort = { column: 'soc' as const, dir: 'desc' as const };
    const progress: [number, number][] = [];
    const { blob, rows } = await exportCsv(
      { scope: 'all', sort, columns },
      state,
      table,
      NAMES,
      (d, t) => progress.push([d, t]),
    );
    const csv = await parse(blob);
    const shown = table.query({ scope: 'all', sort, offset: 0, limit: 200 }).rows;
    expect(rows).toBe(6);
    expect(csv[0]).toEqual([
      'Regno',
      'Fleet',
      'Status',
      'SOC (%)',
      'ODO (km)',
      'Ignition',
      'Last GPS',
      'Location',
    ]);
    expect(csv.slice(1)).toEqual(
      shown.map((r: TableRow) => columns.map((c) => cellText(c, r, NAMES))),
    );
    expect(progress).toEqual([[6, 6]]);
  });

  it('quotes commas, quotes and newlines (RFC 4180); IST timestamps; ungrouped numbers', async () => {
    const { state, table } = setup();
    const { blob } = await exportCsv(
      {
        scope: 'viewport',
        bbox: [72, 18, 73, 20],
        sort: { column: 'regno', dir: 'asc' },
        columns: ['regno', 'odometer', 'gpstime', 'fleet'],
      },
      state,
      table,
      NAMES,
    );
    const text = await blob.text();
    expect(text).toContain('"MH12, ""X""\nY"');
    const [, row] = await parse(blob);
    expect(row).toEqual([
      'MH12, "X"\nY',
      '10',
      cellText('gpstime', { gpstime: BASE_T } as TableRow, NAMES),
      'South',
    ]);
    expect(row![2]).toMatch(/^\d{2} \w{3} \d{2} \| \d{2}:\d{2}:\d{2}$/);
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('plain')).toBe('plain');
    expect(cellText('odometer', { odometer: 123456.7 } as TableRow, NAMES)).toBe('123456');
  });

  it('every column has a header label and text for a row without values', () => {
    const { table } = setup();
    const empty = table.row(5);
    for (const c of TABLE_COLUMN_IDS) expect(typeof cellText(c, empty, {})).toBe('string');
  });
});

describe('F09-T4: tray-query', () => {
  it('bbox, matching only, ordered by status priority then most recent update, limited', () => {
    const { state } = setup();
    const all = (
      bbox: [number, number, number, number],
      limit?: number,
      match = (_i: number) => true,
    ) => trayQuery(state, match, statusRulesConfig.priority, bbox, limit).map((c) => c.vehicleId);
    // Priority: … running before stopped. Running: v0, v3 (same utctime → id); stopped by recency.
    expect(all([70, 10, 80, 30])).toEqual(['v0', 'v3', 'v4', 'v1', 'v2']);
    expect(all([77, 12, 78, 13])).toEqual(['v0', 'v1', 'v2']);
    expect(all([70, 10, 80, 30], 2)).toEqual(['v0', 'v3']);
    expect(all([70, 10, 80, 30], 24, (i) => state.str.vehicleId[i] !== 'v0')).toEqual([
      'v3',
      'v4',
      'v1',
      'v2',
    ]);
    const [card] = trayQuery(state, () => true, statusRulesConfig.priority, [77, 12, 78, 13], 1);
    expect(card).toMatchObject({
      vehicleId: 'v0',
      regno: 'KA01AB0003',
      status: 'running',
      soc: 50,
      speed: 30,
      fleetId: 'f0',
    });
  });
});
