// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { applyShape, bucketStart, objectTable } from './widget-shape.ts';

const IST = 330 * 60_000;
const DAY = 86_400_000;
// 2026-10-12 00:00 IST is a Monday.
const MON = Date.UTC(2026, 9, 12) - IST;

const rows = [
  { regno: 'A1', fleet: 'f1', status: 'running', speed: 40, t: MON + 1 * 3_600_000 },
  { regno: 'A2', fleet: 'f1', status: 'stopped', speed: 0, t: MON + 2 * 3_600_000 },
  { regno: 'B1', fleet: 'f2', status: 'running', speed: 70, t: MON + DAY + 5 },
  { regno: 'B2', fleet: 'f2', status: 'running', speed: null, t: MON + 3 * DAY },
  { regno: 'C1', fleet: 'f3', status: 'no-gps', speed: 10, t: MON + 3 * DAY + 9 },
];
const table = objectTable(rows);

describe('F26-T2 shaping core', () => {
  it('filters with all / any, sorts with missing last and limits', () => {
    const r = applyShape(table, {
      filter: {
        all: [{ field: 'speed', op: 'gte', value: 0 }],
        any: [{ field: 'fleet', op: 'eq', value: 'f2' }, { field: 'status', op: 'in', value: ['stopped'] }],
      },
      shape: { sort: { by: 'speed', dir: 'desc' }, limit: 5 },
    });
    expect(r.total).toBe(2);
    expect(r.rows!.map((i) => rows[i]!.regno)).toEqual(['B1', 'A2']);
    const all = applyShape(table, { shape: { sort: { by: 'speed', dir: 'asc' }, limit: 3 } });
    expect(all.rows!.map((i) => rows[i]!.regno)).toEqual(['A2', 'C1', 'A1']);
    const contains = applyShape(table, { filter: { all: [{ field: 'regno', op: 'contains', value: 'b' }] } });
    expect(contains.total).toBe(2);
    const ne = applyShape(table, { filter: { all: [{ field: 'status', op: 'ne', value: 'running' }] } });
    expect(ne.total).toBe(2);
  });

  it('groups and aggregates (count / sum / avg / min / max), sorted by value', () => {
    const count = applyShape(table, { shape: { groupBy: 'fleet' } });
    expect(count.groups!.map((g) => [g.key, g.value])).toEqual([
      ['f1', 2],
      ['f2', 2],
      ['f3', 1],
    ]);
    const avg = applyShape(table, { shape: { groupBy: 'fleet', aggregate: { op: 'avg', field: 'speed' }, sort: { by: 'value', dir: 'desc' } } });
    expect(avg.groups!.map((g) => [g.key, g.value])).toEqual([
      ['f2', 70],
      ['f1', 20],
      ['f3', 10],
    ]);
    expect(applyShape(table, { shape: { aggregate: { op: 'max', field: 'speed' } } }).value).toBe(70);
    expect(applyShape(table, { shape: { aggregate: { op: 'min', field: 'speed' } } }).value).toBe(0);
    expect(applyShape(table, { shape: { aggregate: { op: 'sum', field: 'speed' } } }).value).toBe(120);
    expect(applyShape(table, { shape: { aggregate: { op: 'count' } } }).value).toBe(5);
  });

  it('buckets by IST day / week / hour, fills gaps, and supports 2-D groups', () => {
    expect(bucketStart(MON + 5 * DAY + 7, 'week')).toBe(MON);
    expect(bucketStart(MON + DAY + 5, 'day')).toBe(MON + DAY);
    expect(bucketStart(MON + 90 * 60_000, 'hour')).toBe(MON + 60 * 60_000);
    const days = applyShape(table, { shape: { timeBucket: 'day' } }, { timeField: 't' });
    expect(days.groups!.map((g) => [g.bucket, g.value])).toEqual([
      [MON, 2],
      [MON + DAY, 1],
      [MON + 2 * DAY, 0],
      [MON + 3 * DAY, 2],
    ]);
    const twoD = applyShape(table, { shape: { groupBy: 'fleet', timeBucket: 'week', limit: 2 } }, { timeField: 't' });
    expect(twoD.groups!.map((g) => [g.key, g.bucket, g.value])).toEqual([
      ['f1', MON, 2],
      ['f2', MON, 2],
    ]);
  });
});
