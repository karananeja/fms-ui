import type { Combinfo, Lafparsed } from '@shared/contract/index.ts';
import { describe, expect, it } from 'vitest';
import combinfoSample from '../../../../mock-server/fixtures/combinfo-sample.json';
import lafparsedSample from '../../../../mock-server/fixtures/lafparsed-sample.json';
import { detailsConfig } from '../config/details-config.ts';
import { formatRelative } from './format-relative.ts';
import {
  badgesModel,
  cellStrip,
  compassLabel,
  DASH,
  deviceModel,
  eventItems,
  filterParameters,
  freshnessTone,
  headerModel,
  highlights,
  locationModel,
  overviewModel,
  parameterCells,
  ringsModel,
  sessionChart,
  signalBars,
  socTone,
} from './vehicle-details-model.ts';

const combinfo = combinfoSample as Combinfo;
const lafparsed = lafparsedSample as Lafparsed;
const MIN = 60_000;
const HOUR = 60 * MIN;

describe('F07-T2: view model from the samples (now = CAN + 31 h, both times ≥ 31 h old)', () => {
  const now = combinfo.canutctime + 31 * HOUR;

  it('header: regno, absolute + relative times with danger dots', () => {
    const h = headerModel(combinfo.vehicleid, null, combinfo, 'pullout', now);
    expect(h).toMatchObject({
      regno: 'P6DED30BPDC002607',
      subtitle: 'BGAUSS · C12 · I MAX',
      fuel: 'EV',
      status: 'pullout',
      illustration: 'e-scooter',
      gps: { abs: '08 Sep 26 | 09:33:42', rel: '31 h ago', tone: 'bad' },
      can: { abs: '08 Sep 26 | 09:33:49', rel: '31 h ago', tone: 'bad' },
      latest: '08 Sep 26 | 09:33:49',
    });
  });

  it('rings, overview, device, badges, location', () => {
    const r = ringsModel(combinfo, lafparsed);
    expect([r.battery.value, r.battery.tone]).toEqual(['49%', 'warn']);
    expect(r.range.value).toBe('56');
    expect([r.health.value, r.health.tone]).toEqual(['100.0', 'ok']);
    expect(overviewModel(combinfo)).toMatchObject({ odo: '1,077 KM', motorSpeed: '0 RPM' });
    expect(deviceModel(combinfo)).toMatchObject({
      aux: '0.07 V',
      auxTone: 'bad',
      internal: '3.60 V',
      fix: 'NONE',
      fixTone: 'warn',
    });
    expect(badgesModel(combinfo)).toEqual({ signal: '−70', bars: 3, fix: 'NONE', fixTone: 'warn' });
    expect(locationModel(combinfo)).toBe('28.70419, 80.56578');
  });

  it('374 parameters, N/A sentinel, highlights, 20-cell strip with the lowest flagged', () => {
    const cells = parameterCells(lafparsed);
    expect(cells).toHaveLength(374);
    expect(cells.find((c) => c.key === 'time_to_charge')).toMatchObject({ value: 'N/A', na: true });
    expect(highlights(lafparsed).map((h) => h.value)).toEqual(['52.6', '17', '27', '878']);
    const strip = cellStrip(lafparsed);
    expect(strip).toHaveLength(20);
    const lowest = strip.filter((c) => c.lowest);
    expect(lowest).toHaveLength(1);
    expect(lowest[0]!.volts).toBe(Math.min(...strip.map((c) => c.volts)));
  });
});

describe('F07-T3: boundaries, chips and search', () => {
  const { okMs, warnMs } = detailsConfig.freshness;
  const now = 1_800_000_000_000;

  it('freshness, SOC bands, signal bars, relative time', () => {
    expect(freshnessTone(now - okMs, now)).toBe('ok');
    expect(freshnessTone(now - okMs - 1, now)).toBe('warn');
    expect(freshnessTone(now - warnMs, now)).toBe('warn');
    expect(freshnessTone(now - warnMs - 1, now)).toBe('bad');
    expect(freshnessTone(0, now)).toBe('none');
    expect([19.9, 20, 59.9, 60, null].map((s) => socTone(s))).toEqual([
      'bad',
      'warn',
      'warn',
      'ok',
      'none',
    ]);
    expect([-69, -70, -71, -85, -86, -100, -101, null].map((d) => signalBars(d))).toEqual([
      3, 3, 2, 2, 1, 1, 0, 0,
    ]);
    expect(formatRelative(now - 59_999, now)).toBe('just now');
    expect(formatRelative(now - 2 * MIN, now)).toBe('2 min ago');
    expect(formatRelative(now - HOUR, now)).toBe('1 h ago');
    expect(formatRelative(now - 47 * HOUR, now)).toBe('47 h ago');
    expect(formatRelative(now - 48 * HOUR, now)).toBe('2 d ago');
    expect(formatRelative(NaN, now)).toBe(DASH);
    expect([0, 22, 23, 302.14, 359].map(compassLabel)).toEqual(['N', 'N', 'NE', 'NW', 'N']);
  });

  it('group chips match the key patterns; search on label or key', () => {
    const cells = parameterCells(lafparsed);
    const keys = cells.map((c) => c.key);
    const count = (f: (k: string) => boolean) => keys.filter(f).length;
    expect(filterParameters(cells, '', 'bms')).toHaveLength(count((k) => k.startsWith('bms_')));
    expect(filterParameters(cells, '', 'mcu')).toHaveLength(count((k) => k.startsWith('mcu_')));
    expect(filterParameters(cells, '', 'cells')).toHaveLength(count((k) => k.startsWith('cell_')));
    expect(filterParameters(cells, '', 'charger')).toHaveLength(
      count((k) => k.startsWith('charger_')),
    );
    expect(filterParameters(cells, '', 'faults')).toHaveLength(count((k) => k.includes('fault')));
    expect(filterParameters(cells, '')).toBe(cells);
    expect(filterParameters(cells, 'cell_voltage')).toHaveLength(23);
    expect(filterParameters(cells, 'Time_To').map((c) => c.key)).toEqual(['time_to_charge']);
    expect(filterParameters(cells, 'CELL VOLTAGE 0').map((c) => c.key)).toHaveLength(9);
  });

  it('missing values show — with empty rings', () => {
    const r = ringsModel(null, null);
    expect(r.battery).toMatchObject({ value: DASH, fill: null });
    const h = headerModel('v1', null, null, null, 0);
    expect(h).toMatchObject({ regno: 'v1', subtitle: '', fuel: null, status: null });
    expect(h.gps).toMatchObject({ abs: DASH, rel: DASH, tone: 'none' });
  });

  it('session chart needs 2 SOC samples; events newest first', () => {
    const s = (t: number, soc: number | null) => ({ t, soc, speed: 0, lat: null, lng: null });
    expect(sessionChart([s(0, 50)])).toBeNull();
    expect(sessionChart([s(0, 50), s(MIN, null)])).toBeNull();
    const chart = sessionChart([s(now, 52), s(now + MIN, 49)])!;
    expect(chart.points).toEqual([
      [0, 0.48],
      [1, 0.51],
    ]);
    expect(chart.tone).toBe('warn');
    const items = eventItems([
      { t: now, kind: 'ignition-on', status: 'running', from: null, soc: 51, lat: null, lng: null },
      { t: now + MIN, kind: 'status', status: 'pullout', from: 'stopped', soc: 49, lat: 1, lng: 2 },
    ]);
    expect(items.map((i) => [i.title, i.detail])).toEqual([
      ['Battery pulled out', '1.00000, 2.00000'],
      ['Ignition on', 'SOC 51%'],
    ]);
  });
});
