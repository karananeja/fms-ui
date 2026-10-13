import type { Combinfo, Lafparsed } from '@shared/contract/index.ts';
import { describe, expect, it } from 'vitest';
import combinfoSample from '../../../../mock-server/fixtures/combinfo-sample.json';
import lafparsedSample from '../../../../mock-server/fixtures/lafparsed-sample.json';
import { detailsConfig } from '../config/details-config.ts';
import {
  DASH,
  deviceModel,
  drivingEnergyModel,
  filterParameters,
  freshnessTone,
  headerModel,
  locationModel,
  parameterCells,
  socTone,
  vehicleDetailsModel,
} from './vehicle-details-model.ts';

const combinfo = combinfoSample as Combinfo;
const lafparsed = lafparsedSample as Lafparsed;
const MIN = 60_000;

describe('F07-T2: view model from the caninfo.md / lafparsed.md samples', () => {
  const now = combinfo.canutctime + 2 * 60 * MIN;
  const view = vehicleDetailsModel({
    vehicleId: combinfo.vehicleid,
    summary: null,
    selected: { vehicleId: combinfo.vehicleid, found: true, status: 'pullout', combinfo, lafparsed },
    now,
  });

  it('header', () => {
    expect(view.header).toEqual({
      vehicleId: 'bgauss_in_7072',
      regno: 'P6DED30BPDC002607',
      subtitle: 'BGauss · C12 · i Max',
      fuel: 'EV',
      status: 'pullout',
      gps: { text: '08 Sep 26 | 09:33:42', tone: 'bad' },
      can: { text: '08 Sep 26 | 09:33:49', tone: 'bad' },
    });
  });

  it('driving · energy', () => {
    expect(view.drivingEnergy).toMatchObject({
      speed: '0',
      soc: '49',
      socPct: 49,
      socTone: 'warn',
      dte: '56',
      soh: '100.0',
      odo: '1,077',
      odoDigits: ['0', '0', '0', '1', '0', '7', '7'],
      rpm: '0',
    });
  });

  it('device, location', () => {
    expect(view.device).toEqual({
      deviceId: '158828DB0439AE67',
      aux: '0.07',
      internal: '3.60',
      signal: '-70',
    });
    expect(view.location).toBe('28.70419, 80.56578');
  });

  it('374 parameters, sorted by label, raw values, N/A sentinel, hover title', () => {
    const p = view.parameters!;
    expect(p).toHaveLength(374);
    const labels = p.map((c) => c.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, 'en')));
    const byKey = Object.fromEntries(p.map((c) => [c.key, c]));
    expect(byKey.time_to_charge!.value).toBe('N/A');
    expect(byKey.odometer).toMatchObject({ label: 'Odometer', value: '1,077.141' });
    expect(byKey.soh!.value).toBe('100');
    expect(byKey.cell_voltage_01).toMatchObject({ label: 'Cell Voltage 01', value: '3.291' });
    expect(byKey._12v_count).toMatchObject({ label: '12V Count', value: '10,244' });
    expect(byKey.soc!.title).toBe('soc · 08 Sep 26 | 08:24:19');
  });
});

describe('F07-T3: bands, missing values, search', () => {
  const { okMs, warnMs } = detailsConfig.freshness;

  it('freshness at each boundary (server-corrected now)', () => {
    const now = 1_800_000_000_000;
    expect(freshnessTone(now, now)).toBe('ok');
    expect(freshnessTone(now + 5000, now)).toBe('ok');
    expect(freshnessTone(now - okMs, now)).toBe('ok');
    expect(freshnessTone(now - okMs - 1, now)).toBe('warn');
    expect(freshnessTone(now - warnMs, now)).toBe('warn');
    expect(freshnessTone(now - warnMs - 1, now)).toBe('bad');
    expect(freshnessTone(0, now)).toBe('none');
    expect(freshnessTone(NaN, now)).toBe('none');
  });

  it('SOC colour bands at each boundary', () => {
    expect(socTone(0)).toBe('bad');
    expect(socTone(19.9)).toBe('bad');
    expect(socTone(20)).toBe('warn');
    expect(socTone(59.9)).toBe('warn');
    expect(socTone(60)).toBe('ok');
    expect(socTone(100)).toBe('ok');
    expect(socTone(null)).toBe('none');
  });

  it('missing values show —', () => {
    const c = structuredClone(combinfo) as Combinfo;
    const can = c.parsedcandata as Partial<Combinfo['parsedcandata']>;
    delete can.soc;
    delete can.odometer;
    can.dte!.pidvalue = 65535;
    c.speed = NaN;
    c.carbattery = NaN;
    c.latitude = 0;
    c.longitude = 0;
    const d = drivingEnergyModel(c, null);
    expect(d).toMatchObject({
      speed: DASH,
      soc: DASH,
      socPct: null,
      socTone: 'none',
      dte: DASH,
      soh: DASH,
      odo: DASH,
      odoDigits: Array(7).fill('-'),
    });
    expect(deviceModel(c).aux).toBe(DASH);
    expect(locationModel(c)).toBe(DASH);
    const h = headerModel('v1', null, null, null, 0);
    expect(h).toMatchObject({ regno: 'v1', subtitle: '', fuel: null, status: null });
    expect(h.gps).toEqual({ text: DASH, tone: 'none' });
  });

  it('parameter search matches label or key, case-insensitively', () => {
    const cells = parameterCells(lafparsed);
    expect(filterParameters(cells, '')).toBe(cells);
    expect(filterParameters(cells, 'cell_voltage')).toHaveLength(23);
    expect(filterParameters(cells, 'CELL VOLTAGE 0').map((c) => c.key)).toEqual(
      Array.from({ length: 9 }, (_, i) => `cell_voltage_0${i + 1}`),
    );
    expect(filterParameters(cells, 'Time_To').map((c) => c.key)).toEqual(['time_to_charge']);
    expect(filterParameters(cells, 'zzz')).toHaveLength(0);
  });
});
