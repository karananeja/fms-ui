// @vitest-environment node
import {
  COMBINFO_DELTA_FIELDS,
  COMBINFO_LEAVE_FIELDS,
  COMBINFO_SNAPSHOT_FIELDS,
  LAFPARSED_BASE_FIELDS,
} from '@shared/contract/ws-protocol.ts';
import { VEHICLE_STATUSES, type VehicleStatus } from '@shared/domain/vehicle-status.ts';
import { describe, expect, it } from 'vitest';
import {
  statusLafPids,
  statusRulesConfig,
  type StatusRulesConfig,
} from '../config/status-rules-config.ts';
import { parseStatusRulesConfig } from '../config/status-rules-schema.ts';
import { FleetState } from './fleet-state.ts';
import { deriveStatus, StatusTracker, type StatusInput } from './status-deriver.ts';
import { BASE_T, deltaRow, snapshotRow } from './testing/fake-socket.ts';

const MIN = 60_000;
const NOW = BASE_T;
const PIDS = statusLafPids(statusRulesConfig);
const LAF_FIELDS = [...LAFPARSED_BASE_FIELDS, ...PIDS];

/** Healthy, communicating, ignition on, speed 0 → stopped. */
const base: StatusInput = {
  lat: 12.97,
  lng: 77.59,
  utctime: NOW,
  gpstime: NOW,
  carbattery: 12.6,
  immobilization_status: 0,
  ignstatus: 1,
  speed: 0,
  pids: { mcu_charge_plug_status: 0, charger_status: 0 },
};
const v = (over: StatusInput = {}, pids: Record<string, number | null> = {}): StatusInput => ({
  ...base,
  ...over,
  pids: { ...base.pids, ...pids },
});

const withConfig = (patch: (c: StatusRulesConfig) => void): StatusRulesConfig => {
  const c = structuredClone(statusRulesConfig) as StatusRulesConfig;
  patch(c);
  return c;
};

describe('F05-T1: rules, boundaries and priority (default config)', () => {
  const cases: [string, StatusInput, VehicleStatus][] = [
    ['ignition on, speed 0', v(), 'stopped'],
    ['ignition off', v({ ignstatus: 0 }), 'stopped'],
    // gps-never
    ['lat/lng 0,0', v({ lat: 0, lng: 0 }), 'gps-never'],
    ['only lat 0', v({ lat: 0 }), 'stopped'],
    ['only lng 0', v({ lng: 0 }), 'stopped'],
    ['lat NaN', v({ lat: NaN }), 'gps-never'],
    ['lng missing', v({ lng: undefined }), 'gps-never'],
    ['lat null', v({ lat: null }), 'gps-never'],
    // non-comm (strict >)
    ['utctime exactly 30 min old', v({ utctime: NOW - 30 * MIN }), 'stopped'],
    ['utctime 30 min + 1 ms old', v({ utctime: NOW - 30 * MIN - 1 }), 'non-comm'],
    ['utctime 30 min − 1 ms old', v({ utctime: NOW - 30 * MIN + 1 }), 'stopped'],
    // pullout (strict <)
    ['carbattery exactly 1.0 V', v({ carbattery: 1.0 }), 'stopped'],
    ['carbattery 0.99 V', v({ carbattery: 0.99 }), 'pullout'],
    ['carbattery 1.01 V', v({ carbattery: 1.01 }), 'stopped'],
    ['carbattery sample 0.07 V', v({ carbattery: 0.07 }), 'pullout'],
    ['carbattery missing', v({ carbattery: NaN }), 'stopped'],
    // immobilized
    ['immobilization_status 1', v({ immobilization_status: 1 }), 'immobilized'],
    ['immobilization_status 0', v({ immobilization_status: 0 }), 'stopped'],
    ['immobilization_status 2', v({ immobilization_status: 2 }), 'stopped'],
    // charging (null / NaN never match, for equals and notEquals)
    ['plug 1', v({}, { mcu_charge_plug_status: 1 }), 'charging'],
    ['plug 2', v({}, { mcu_charge_plug_status: 2 }), 'stopped'],
    ['charger 1', v({}, { charger_status: 1 }), 'charging'],
    ['charger 3', v({}, { charger_status: 3 }), 'charging'],
    ['charger −1', v({}, { charger_status: -1 }), 'charging'],
    [
      'plug null, charger null',
      v({}, { mcu_charge_plug_status: null, charger_status: null }),
      'stopped',
    ],
    [
      'plug NaN, charger NaN',
      v({}, { mcu_charge_plug_status: NaN, charger_status: NaN }),
      'stopped',
    ],
    ['PIDs never arrived', { ...base, pids: {} }, 'stopped'],
    // no-gps (strict >)
    ['gpstime exactly 10 min old', v({ gpstime: NOW - 10 * MIN }), 'stopped'],
    ['gpstime 10 min + 1 ms old', v({ gpstime: NOW - 10 * MIN - 1 }), 'no-gps'],
    ['gpstime 10 min − 1 ms old', v({ gpstime: NOW - 10 * MIN + 1 }), 'stopped'],
    // running (strict >)
    ['speed exactly 2', v({ speed: 2 }), 'stopped'],
    ['speed 2.01', v({ speed: 2.01 }), 'running'],
    ['speed 1.99', v({ speed: 1.99 }), 'stopped'],
    ['speed 60, ignition off', v({ speed: 60, ignstatus: 0 }), 'stopped'],
    ['speed 60, ignition missing', v({ speed: 60, ignstatus: NaN }), 'stopped'],
    ['speed 60, ignition on', v({ speed: 60 }), 'running'],
    // priority conflicts
    ['non-comm + pullout', v({ utctime: NOW - 31 * MIN, carbattery: 0.1 }), 'non-comm'],
    ['pullout + charging', v({ carbattery: 0.1 }, { charger_status: 1 }), 'pullout'],
    ['immobilized + running', v({ immobilization_status: 1, speed: 40 }), 'immobilized'],
    ['gps-never + non-comm', v({ lat: 0, lng: 0, utctime: NOW - 31 * MIN }), 'gps-never'],
    [
      'immobilized + charging',
      v({ immobilization_status: 1 }, { mcu_charge_plug_status: 1 }),
      'immobilized',
    ],
    ['charging + no-gps', v({ gpstime: NOW - 11 * MIN }, { charger_status: 1 }), 'charging'],
    ['no-gps + running', v({ gpstime: NOW - 11 * MIN, speed: 40 }), 'no-gps'],
    ['non-comm + no-gps', v({ utctime: NOW - 31 * MIN, gpstime: NOW - 31 * MIN }), 'non-comm'],
  ];

  it.each(cases)('%s → %s', (_, input, expected) => {
    expect(deriveStatus(input, NOW)).toBe(expected);
  });

  it('covers every status', () => {
    expect(new Set(cases.map((c) => c[2]))).toEqual(new Set(VEHICLE_STATUSES));
  });
});

describe('F05-T2: config drives the rules', () => {
  it('a reordered priority changes the winner', () => {
    const c = withConfig((c) => {
      c.priority = [
        'gps-never',
        'non-comm',
        'pullout',
        'running',
        'immobilized',
        'charging',
        'no-gps',
        'stopped',
      ];
    });
    const input = v({ immobilization_status: 1, speed: 40 });
    expect(deriveStatus(input, NOW)).toBe('immobilized');
    expect(deriveStatus(input, NOW, c)).toBe('running');
  });

  it('new thresholds apply', () => {
    const c = withConfig((c) => {
      c.thresholds = { nonCommMs: 5 * MIN, noGpsMs: 2 * MIN, pulloutVolts: 9, runningSpeedKmh: 50 };
    });
    expect(deriveStatus(v({ utctime: NOW - 6 * MIN }), NOW, c)).toBe('non-comm');
    expect(deriveStatus(v({ gpstime: NOW - 3 * MIN }), NOW, c)).toBe('no-gps');
    expect(deriveStatus(v({ carbattery: 8.5 }), NOW, c)).toBe('pullout');
    expect(deriveStatus(v({ speed: 40 }), NOW, c)).toBe('stopped');
    expect(deriveStatus(v({ speed: 51 }), NOW, c)).toBe('running');
  });

  it('a different charging PID / immobilized field is evaluated and subscribed', () => {
    const c = withConfig((c) => {
      c.charging = { anyOf: [{ pid: 'bms_charging_state', equals: 2 }] };
      c.immobilized = { field: 'immo_pid', equals: 1 };
    });
    expect(deriveStatus(v({}, { bms_charging_state: 2 }), NOW, c)).toBe('charging');
    expect(deriveStatus(v({}, { mcu_charge_plug_status: 1, charger_status: 1 }), NOW, c)).toBe(
      'stopped',
    );
    expect(deriveStatus(v({ immobilization_status: 1 }), NOW, c)).toBe('stopped');
    expect(deriveStatus(v({}, { immo_pid: 1 }), NOW, c)).toBe('immobilized');
    expect(statusLafPids(c)).toEqual(['bms_charging_state', 'immo_pid']);
    expect(statusLafPids(statusRulesConfig)).toEqual(['mcu_charge_plug_status', 'charger_status']);
  });

  it('accepts the default config', () => {
    expect(parseStatusRulesConfig(statusRulesConfig)).toEqual(statusRulesConfig);
  });

  const invalid: [string, (c: StatusRulesConfig) => void, RegExp][] = [
    ['unknown status', (c) => ((c.priority as string[])[0] = 'parked'), /priority\[0\]/],
    [
      'duplicate status',
      (c) => ((c.priority as string[])[1] = 'gps-never'),
      /duplicate status "gps-never"[\s\S]*missing status "non-comm"/,
    ],
    [
      'missing status',
      (c) => (c.priority = c.priority.filter((s) => s !== 'charging')),
      /missing status "charging"/,
    ],
    [
      'stopped not last',
      (c) => (c.priority = ['stopped', ...c.priority.slice(0, -1)]),
      /"stopped" must be last/,
    ],
    ['zero threshold', (c) => (c.thresholds.nonCommMs = 0), /thresholds\.nonCommMs/],
    ['negative threshold', (c) => (c.thresholds.pulloutVolts = -1), /thresholds\.pulloutVolts/],
    ['infinite threshold', (c) => (c.thresholds.noGpsMs = Infinity), /thresholds\.noGpsMs/],
    ['zero sweep interval', (c) => (c.sweepIntervalMs = 0), /sweepIntervalMs/],
    ['empty charging', (c) => (c.charging = { anyOf: [] }), /charging\.anyOf/],
    [
      'charging without a value',
      (c) => (c.charging = { anyOf: [{ pid: 'x' } as never] }),
      /charging\.anyOf\[0\]/,
    ],
    ['typo key', (c) => Object.assign(c.thresholds, { nonComMs: 1 }), /nonComMs/],
  ];

  it.each(invalid)('rejects %s with a clear error', (_, patch, message) => {
    const run = () => parseStatusRulesConfig(withConfig(patch));
    expect(run).toThrow(/^Invalid status rules config/);
    expect(run).toThrow(message);
  });
});

describe('F05-T5: server displayStatus', () => {
  it('overrides the rules when valid', () => {
    expect(deriveStatus(v({ displayStatus: 'charging' }), NOW)).toBe('charging');
    expect(deriveStatus(v({ lat: 0, lng: 0, displayStatus: 'running' }), NOW)).toBe('running');
  });

  it.each([['Running'], ['parked'], [''], [3], [null]])('ignores invalid value %j', (bad) => {
    expect(deriveStatus(v({ speed: 40, displayStatus: bad }), NOW)).toBe('running');
  });

  it('is ignored when preferServerStatus is off', () => {
    const c = withConfig((c) => (c.preferServerStatus = false));
    expect(deriveStatus(v({ displayStatus: 'charging' }), NOW, c)).toBe('stopped');
  });

  it('is read from a displayStatus combinfo column in the fleet state', () => {
    const { state, tracker } = tracked();
    const fields = [...COMBINFO_SNAPSHOT_FIELDS, 'displayStatus'];
    state.applyCombinfo(fields, [
      [...snapshotRow(0), 'immobilized'],
      [...snapshotRow(1), 'bogus'],
    ]);
    expect(tracker.statusOf(state.indexOf('v0'))).toBe('immobilized');
    expect(tracker.statusOf(state.indexOf('v1'))).toBe('running');
  });
});

// ---- fleet-state tracking ----

function tracked(cfg: StatusRulesConfig = statusRulesConfig, capacity = 4) {
  const state = new FleetState({ pids: statusLafPids(cfg), capacity });
  const tracker = new StatusTracker(state, cfg);
  tracker.now = NOW;
  return { state, tracker };
}

function expectCounts(state: FleetState, tracker: StatusTracker) {
  const counts = tracker.statusCounts();
  const recount = Object.fromEntries(VEHICLE_STATUSES.map((s) => [s, 0]));
  for (let i = 0; i < state.count; i++) recount[tracker.statusOf(i)!]!++;
  expect(counts).toEqual(recount);
  expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(state.count);
  expect(tracker.total).toBe(state.count);
}

describe('F05-T3: sweep with fake time', () => {
  it('a silent vehicle becomes no-gps after 10 min and non-comm after 30 min; counts follow', () => {
    const { state, tracker } = tracked();
    state.applyCombinfo(COMBINFO_SNAPSHOT_FIELDS, [
      snapshotRow(0, { speed: 0 }),
      snapshotRow(1, { speed: 0 }),
    ]);
    expect(tracker.statusCounts()).toMatchObject({ stopped: 2 });
    expect(tracker.sweep(NOW + 10 * MIN)).toBe(0);
    expect(tracker.sweep(NOW + 10 * MIN + 1000)).toBe(2);
    expect(tracker.statusCounts()).toMatchObject({ stopped: 0, 'no-gps': 2 });
    // A fresh row for v1 brings it back.
    tracker.now = NOW + 11 * MIN;
    state.applyCombinfo(COMBINFO_DELTA_FIELDS, [
      deltaRow(1, { speed: 0, utctime: NOW + 11 * MIN, gpstime: NOW + 11 * MIN }),
    ]);
    expect(tracker.statusCounts()).toMatchObject({ stopped: 1, 'no-gps': 1 });
    expect(tracker.sweep(NOW + 30 * MIN + 1000)).toBe(2); // v0 → non-comm, v1 → no-gps
    expect(tracker.statusOf(state.indexOf('v0'))).toBe('non-comm');
    expect(tracker.statusCounts()).toMatchObject({ 'non-comm': 1, 'no-gps': 1 });
    expectCounts(state, tracker);
  });

  it('re-evaluates on lafparsed rows', () => {
    const { state, tracker } = tracked();
    state.applyCombinfo(COMBINFO_SNAPSHOT_FIELDS, [snapshotRow(0, { speed: 0 })]);
    state.applyLafparsed(LAF_FIELDS, [['d0', NOW, 1, 0]]);
    expect(tracker.statusOf(0)).toBe('charging');
    state.applyLafparsed(LAF_FIELDS, [['d0', NOW + 1, 0, 0]]);
    expect(tracker.statusOf(0)).toBe('stopped');
  });
});

/** Deterministic PRNG (mulberry32). */
function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('F05-T4: counts always sum to total', () => {
  it('holds across random insert / update / lafparsed / remove / reconcile / sweep sequences', () => {
    const rnd = prng(7);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
    const { state, tracker } = tracked(statusRulesConfig, 2);
    let t = NOW;
    const live = (n: number) => ({
      lat: pick([0, 12.9, 13.1]),
      lng: pick([0, 77.5]),
      speed: pick([0, 2, 30]),
      ignstatus: pick([0, 1]),
      carbattery: pick([0.07, 1, 12]),
      immobilization_status: pick([0, 0, 1]),
      utctime: t - pick([0, 11 * MIN, 31 * MIN]),
      gpstime: t - pick([0, 11 * MIN]),
      vehicleId: `v${n}`,
    });
    for (let step = 0; step < 3000; step++) {
      t += Math.floor(rnd() * 20_000);
      tracker.now = t;
      const n = Math.floor(rnd() * 120);
      const op = rnd();
      if (op < 0.35) state.applyCombinfo(COMBINFO_SNAPSHOT_FIELDS, [snapshotRow(n, live(n))]);
      else if (op < 0.6) state.applyCombinfo(COMBINFO_DELTA_FIELDS, [deltaRow(n, live(n))]);
      else if (op < 0.75)
        state.applyLafparsed(LAF_FIELDS, [[`d${n}`, t, pick([null, 0, 1]), pick([null, 0, 1, 2])]]);
      else if (op < 0.9) state.applyCombinfo(COMBINFO_LEAVE_FIELDS, [[`v${n}`, null]]);
      else if (op < 0.97) tracker.sweep(t);
      else {
        state.beginSnapshot();
        const keep = Array.from({ length: 60 }, () => Math.floor(rnd() * 120));
        state.applyCombinfo(
          COMBINFO_SNAPSHOT_FIELDS,
          keep.map((k) => snapshotRow(k, live(k))),
        );
        state.endSnapshot();
      }
      expectCounts(state, tracker);
    }
    expect(state.capacity).toBeGreaterThan(2);
    // After a sweep every vehicle matches the pure evaluation at that time.
    tracker.sweep(t);
    for (let i = 0; i < state.count; i++) {
      const s = state.summary(i);
      expect(tracker.statusOf(i)).toBe(deriveStatus({ ...s, pids: s.pids }, t));
    }
  });
});

describe('F05-T7: sweep performance', () => {
  it('a full sweep over 100 000 vehicles takes ≤ 20 ms (target 5 ms)', () => {
    const N = 100_000;
    const rnd = prng(42);
    const { state, tracker } = tracked(statusRulesConfig, 1024);
    const rows: unknown[][] = [];
    for (let n = 0; n < N; n++) {
      const r = rnd();
      rows.push(
        snapshotRow(n, {
          lat: r < 0.01 ? 0 : 12.9,
          lng: r < 0.01 ? 0 : 77.5,
          utctime: NOW - (r < 0.09 ? 40 * MIN : 0),
          gpstime: NOW - (r > 0.09 && r < 0.14 ? 15 * MIN : 0),
          carbattery: r > 0.14 && r < 0.19 ? 0.07 : 12.4,
          immobilization_status: r > 0.19 && r < 0.23 ? 1 : 0,
          speed: r > 0.6 ? 35 : 0,
        }),
      );
    }
    state.applyCombinfo(COMBINFO_SNAPSHOT_FIELDS, rows);
    state.applyLafparsed(
      LAF_FIELDS,
      Array.from({ length: N }, (_, n) => [`d${n}`, NOW, n % 12 === 0 ? 1 : 0, 0]),
    );
    expect(state.count).toBe(N);
    const times: number[] = [];
    for (let k = 0; k < 25; k++) {
      const t0 = performance.now();
      tracker.sweep(NOW + (k % 2) * 11 * MIN);
      times.push(performance.now() - t0);
    }
    const measured = times.slice(5).sort((a, b) => a - b);
    const median = measured[Math.floor(measured.length / 2)]!;
    const max = measured.at(-1)!;
    console.log(
      `[F05-T7] sweep over ${N} vehicles: median ${median.toFixed(2)} ms, max ${max.toFixed(2)} ms (20 runs after 5 warm-up)`,
    );
    expectCounts(state, tracker);
    expect(median).toBeLessThanOrEqual(20);
  });
});
