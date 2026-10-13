import {
  COMBINFO_LIVE_FIELDS,
  type Combinfo,
  type Lafparsed,
  type Pid,
  type VehicleMeta,
} from '@shared/contract/index.ts';
import combinfoSample from '../fixtures/combinfo-sample.json' with { type: 'json' };
import lafparsedSample from '../fixtures/lafparsed-sample.json' with { type: 'json' };
import { CENTRES, MODELS } from './catalogue.ts';
import type { FleetTree } from './fleet-tree.ts';
import { hash32, unit } from './random.ts';

/**
 * Behaviour profile. The generator only produces raw fields from it; status is
 * always derived by the F05 rules (never set here).
 */
export const PERSONA = {
  normal: 0,
  gpsNever: 1,
  nonComm: 2,
  noGps: 3,
  pullout: 4,
  immobilized: 5,
} as const;
const PERSONA_CUMULATIVE: [number, number][] = [
  [PERSONA.gpsNever, 0.01],
  [PERSONA.nonComm, 0.09],
  [PERSONA.noGps, 0.14],
  [PERSONA.pullout, 0.19],
  [PERSONA.immobilized, 0.23],
  [PERSONA.normal, 1],
];

/** Duty cycle (fraction of the cycle): drive, then stop, then charge (EVs only). */
const DRIVE_END = 0.49;
const CHARGE_FROM = 0.87;
/** A driving vehicle reports speed 0 this often (signals, traffic). */
const HALT_SHARE = 0.08;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NON_COMM_EPOCH = 3 * DAY;
const NO_GPS_EPOCH = DAY;
const KM_PER_DEG = 111.32;
/** Duty cycles (and so odometers) count from this instant. */
const SIM_EPOCH = Date.UTC(2026, 8, 1);

const S = {
  persona: 1,
  model: 2,
  level: 3,
  fleet: 4,
  centre: 5,
  path: 6,
  speed: 7,
  cycle: 8,
  report: 9,
  age: 10,
  soc: 11,
  odo: 12,
  noise: 13,
  regno: 14,
  vin: 15,
  sign: 16,
} as const;

export interface LiveState {
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  ignstatus: number;
  carbattery: number;
  devbattery: number;
  fixquality: number;
  utctime: number;
  gpstime: number;
  canutctime: number;
  soc: number;
  dte: number;
  odometer: number;
  immobilization_status: number;
  charging: number;
  current: number;
  rxdbm: number;
  lastignon: number;
  lastignoff: number;
}

const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;
const hex8 = (n: number) => (n >>> 0).toString(16).toUpperCase().padStart(8, '0');
const LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ';

const lafTemplate = lafparsedSample as Lafparsed;
const PID_NAMES = Object.keys(lafTemplate.candata);
const PID_ENTRIES = PID_NAMES.map((name) => {
  const pid = lafTemplate.candata[name]!;
  return { name, pid, age: lafTemplate.msgtimestamp - pid.timestamp };
});
export const PID_SET: ReadonlySet<string> = new Set(PID_NAMES);
const DYNAMIC_PIDS = new Set([
  'soc',
  'dte',
  'remaining_range',
  'odometer',
  'mcu_total_odo',
  'mcu_speed',
  'current',
  'mcu_charge_plug_status',
  'charger_status',
  'immobilization_status',
]);
const combTemplate = combinfoSample as Combinfo;

/**
 * Columnar vehicle state. Static per-vehicle parameters live in typed arrays; everything
 * live is a pure function of (seed, vehicle, t), so trails need no storage.
 */
export class VehicleSim {
  readonly fleet: Uint32Array;
  readonly model: Uint8Array;
  readonly persona: Uint8Array;
  readonly centre: Uint8Array;
  readonly radiusKm: Float32Array;
  readonly lobes: Uint8Array;
  readonly lobeAmp: Float32Array;
  readonly pathRot: Float32Array;
  readonly speedKmh: Float32Array;
  readonly cycleMs: Float32Array;
  readonly cyclePhase: Float32Array;
  readonly reportPhase: Float32Array;
  readonly ageMs: Float32Array;
  readonly socHi: Uint8Array;
  readonly socDrop: Uint8Array;
  readonly odoBase: Float32Array;
  private readonly scratch = {} as LiveState;
  private readonly devicePrefix: string;

  constructor(
    readonly seed: number,
    readonly count: number,
    readonly intervalMs: number,
    readonly tree: FleetTree,
  ) {
    this.fleet = new Uint32Array(count);
    this.model = new Uint8Array(count);
    this.persona = new Uint8Array(count);
    this.centre = new Uint8Array(count);
    this.radiusKm = new Float32Array(count);
    this.lobes = new Uint8Array(count);
    this.lobeAmp = new Float32Array(count);
    this.pathRot = new Float32Array(count);
    this.speedKmh = new Float32Array(count);
    this.cycleMs = new Float32Array(count);
    this.cyclePhase = new Float32Array(count);
    this.reportPhase = new Float32Array(count);
    this.ageMs = new Float32Array(count);
    this.socHi = new Uint8Array(count);
    this.socDrop = new Uint8Array(count);
    this.odoBase = new Float32Array(count);
    this.devicePrefix = hex8(hash32(seed, 0xdec1ce));

    const totalWeight = MODELS.reduce((s, m) => s + m.weight, 0);
    const levels = tree.seededByDepth;
    for (let i = 0; i < count; i++) {
      const r = (salt: number, k = 0) => unit(seed + salt, i, k);

      const pu = r(S.persona);
      const persona = PERSONA_CUMULATIVE.find(([, c]) => pu < c)![0];
      this.persona[i] = persona;

      let w = r(S.model) * totalWeight;
      let mi = 0;
      while (mi < MODELS.length - 1 && (w -= MODELS[mi]!.weight) >= 0) mi++;
      this.model[i] = mi;

      const lu = r(S.level);
      const depth = lu < 0.05 ? 2 : lu < 0.2 ? 3 : lu < 0.5 ? 4 : 5;
      const atDepth = levels[depth]!;
      const fleetIdx = atDepth[Math.floor(r(S.fleet) * atDepth.length)]!;
      this.fleet[i] = fleetIdx;
      tree.direct[fleetIdx]!++;
      const node = tree.node(fleetIdx);
      const city = node.city >= 0 ? node.city : node.region * 5 + Math.floor(r(S.centre, 1) * 5);
      this.centre[i] = city * 2 + (r(S.centre) < 0.6 ? 0 : 1);

      this.radiusKm[i] = 1.5 + r(S.path) * 12;
      this.lobes[i] = 2 + Math.floor(r(S.path, 1) * 4);
      this.lobeAmp[i] = 0.05 + r(S.path, 2) * 0.3;
      this.pathRot[i] = r(S.path, 3) * Math.PI * 2;
      const [lo, hi] = MODELS[mi]!.speedKmh;
      this.speedKmh[i] = lo + r(S.speed) * (hi - lo);
      this.cycleMs[i] = Math.round((60 + r(S.cycle) * 120) * MIN);
      this.cyclePhase[i] = r(S.cycle, 1);
      this.reportPhase[i] = r(S.report);
      this.ageMs[i] =
        persona === PERSONA.nonComm
          ? 31 * MIN + r(S.age) * 2 * DAY
          : persona === PERSONA.noGps
            ? 11 * MIN + r(S.age) * 3 * HOUR
            : r(S.age) * 12 * HOUR;
      this.socHi[i] = 70 + Math.floor(r(S.soc) * 31);
      this.socDrop[i] = 20 + Math.floor(r(S.soc, 1) * 31);
      this.odoBase[i] = 200 + r(S.odo) * 40_000;
    }
  }

  // ---- time ----

  private reportTime(i: number, k: number): number {
    const I = this.intervalMs;
    return Math.round(
      (k + this.reportPhase[i]!) * I + (unit(this.seed + S.report, i, k) - 0.5) * 0.4 * I,
    );
  }

  /** Index of the last scheduled report at or before `t`. */
  private reportIndex(i: number, t: number): number {
    let k = Math.floor(t / this.intervalMs - this.reportPhase[i]!) + 1;
    while (this.reportTime(i, k) > t) k--;
    return k;
  }

  /** Last time the frozen value of a long-lived outage was refreshed (always `age` or more before `t`). */
  private frozen(i: number, t: number, epoch: number): number {
    const off = this.reportPhase[i]! * epoch;
    return Math.round(Math.floor((t - off) / epoch) * epoch + off - this.ageMs[i]!);
  }

  /** Time of this vehicle's latest report at or before `t`. Non-comm vehicles stopped reporting. */
  reportAt(i: number, t: number): number {
    if (this.persona[i] === PERSONA.nonComm) return this.frozen(i, t, NON_COMM_EPOCH);
    return this.reportTime(i, this.reportIndex(i, t));
  }

  // ---- metadata ----

  vehicleId(i: number): string {
    return `${MODELS[this.model[i]!]!.slug}_in_${i}`;
  }

  indexOf(vehicleId: string): number {
    const i = Number(vehicleId.slice(vehicleId.lastIndexOf('_') + 1));
    return Number.isInteger(i) && i >= 0 && i < this.count && this.vehicleId(i) === vehicleId
      ? i
      : -1;
  }

  deviceId(i: number): string {
    return this.devicePrefix + hex8(Math.imul(i, 0x9e3779b1) ^ this.seed);
  }

  regno(i: number): string {
    const centre = CENTRES[this.centre[i]!]!;
    const rto = String(1 + (hash32(this.seed + S.regno, i) % 20)).padStart(2, '0');
    const n = (i * 7919 + this.seed) % 6_760_000;
    const series = Math.floor(n / 10_000);
    const a = String.fromCharCode(65 + Math.floor(series / 26));
    const b = String.fromCharCode(65 + (series % 26));
    return `${centre.state}${rto}${a}${b}${String(n % 10_000).padStart(4, '0')}`;
  }

  vin(i: number): string {
    const m = MODELS[this.model[i]!]!;
    const h = hash32(this.seed + S.vin, i);
    const check = String(h % 10);
    const year = 'NPRS'[(h >>> 4) % 4];
    const plant = LETTERS[(h >>> 8) % 8];
    const serial = String((i * 7919 + this.seed) % 1_000_000).padStart(6, '0');
    return `${m.wmi}${m.vds.slice(0, 5)}${check}${year}${plant}${serial}`;
  }

  fleetId(i: number): string {
    return this.tree.node(this.fleet[i]!).id;
  }

  meta(i: number): VehicleMeta {
    const m = MODELS[this.model[i]!]!;
    return {
      vehicleId: this.vehicleId(i),
      deviceId: this.deviceId(i),
      regno: this.regno(i),
      vin: this.vin(i),
      fleetId: this.fleetId(i),
      assetType: m.assetType,
      fuelType: m.fuelType,
      make: m.make,
      model: m.model,
      variant: m.variant,
    };
  }

  metaRow(i: number): unknown[] {
    const m = MODELS[this.model[i]!]!;
    return [
      this.vehicleId(i),
      this.deviceId(i),
      this.regno(i),
      this.vin(i),
      this.fleetId(i),
      m.assetType,
      m.fuelType,
      m.make,
      m.model,
      m.variant,
    ];
  }

  // ---- live state ----

  /** Raw live state as of the vehicle's latest report at or before `t`. Reuses one scratch object. */
  state(i: number, t: number): LiveState {
    return this.stateAtReport(i, this.reportAt(i, t));
  }

  private stateAtReport(i: number, r: number): LiveState {
    const s = this.scratch;
    const m = MODELS[this.model[i]!]!;
    const persona = this.persona[i]!;
    const noise = (k: number) => unit(this.seed + S.noise, i, (Math.floor(r / 1000) + k) | 0);
    const cycle = this.cycleMs[i]!;
    const hi = this.socHi[i]!;
    const lo = hi - this.socDrop[i]!;

    let driveMs = 0;
    let mode: 'drive' | 'stop' | 'charge' = 'stop';
    let u = 0.6;
    let cycleStart = 0;
    if (persona === PERSONA.normal) {
      const x = (r - SIM_EPOCH) / cycle + this.cyclePhase[i]!;
      const n = Math.floor(x);
      u = x - n;
      mode = u < DRIVE_END ? 'drive' : m.fuelType === 'EV' && u >= CHARGE_FROM ? 'charge' : 'stop';
      driveMs = (n * DRIVE_END + Math.min(u, DRIVE_END)) * cycle;
      cycleStart = SIM_EPOCH + (n - this.cyclePhase[i]!) * cycle;
    }
    const distKm = (driveMs / HOUR) * this.speedKmh[i]!;
    this.position(i, distKm, s);

    s.speed =
      mode === 'drive' && noise(1) >= HALT_SHARE
        ? round(this.speedKmh[i]! * (0.6 + 0.8 * noise(2)), 1)
        : 0;
    s.ignstatus = mode === 'drive' ? 1 : 0;
    s.charging = mode === 'charge' ? 1 : 0;
    s.immobilization_status = persona === PERSONA.immobilized ? 1 : 0;
    s.soc = Math.round(
      mode === 'drive'
        ? hi - (u / DRIVE_END) * (hi - lo)
        : mode === 'charge'
          ? lo + ((u - CHARGE_FROM) / (1 - CHARGE_FROM)) * (hi - lo)
          : persona === PERSONA.normal
            ? lo
            : lo + 5,
    );
    s.dte = Math.round((s.soc / 100) * m.rangeKm);
    s.odometer = round(this.odoBase[i]! + distKm, 3);
    s.current = mode === 'drive' ? round(s.speed * 0.6, 1) : mode === 'charge' ? -12 : 0;
    s.carbattery =
      persona === PERSONA.pullout
        ? round(0.02 + 0.85 * noise(3), 4)
        : round(m.voltage * (1.02 + 0.08 * noise(3)), 4);
    s.devbattery = round(3.5 + 0.7 * noise(4), 4);
    s.rxdbm = -60 - Math.round(35 * noise(5));
    s.utctime = r;
    s.canutctime = r;

    if (persona === PERSONA.gpsNever) {
      s.lat = 0;
      s.lng = 0;
      s.heading = 0;
      s.gpstime = 0;
      s.fixquality = 0;
    } else if (persona === PERSONA.noGps) {
      s.gpstime = this.frozen(i, r, NO_GPS_EPOCH);
      s.fixquality = 0;
    } else {
      s.gpstime = r - 200 - Math.floor(noise(6) * 2800);
      s.fixquality = 1;
    }

    if (persona === PERSONA.normal) {
      s.lastignon = Math.round(cycleStart);
      s.lastignoff = Math.round(
        mode === 'drive' ? cycleStart - cycle + DRIVE_END * cycle : cycleStart + DRIVE_END * cycle,
      );
    } else {
      s.lastignoff = Math.floor(r / DAY) * DAY - Math.round(this.ageMs[i]! % (12 * HOUR));
      s.lastignon = s.lastignoff - 45 * MIN;
    }
    return s;
  }

  /** Position along the vehicle's seeded closed loop around its city centre. */
  private position(i: number, distKm: number, out: LiveState): void {
    const c = CENTRES[this.centre[i]!]!;
    const R = this.radiusKm[i]!;
    const k = this.lobes[i]!;
    const a = this.lobeAmp[i]!;
    const th = distKm / R + this.pathRot[i]!;
    const rad = R * (1 + a * Math.sin(k * th));
    const dRad = R * a * k * Math.cos(k * th);
    const x = rad * Math.cos(th);
    const y = rad * Math.sin(th);
    const dx = dRad * Math.cos(th) - rad * Math.sin(th);
    const dy = dRad * Math.sin(th) + rad * Math.cos(th);
    out.lat = round(c.lat + y / KM_PER_DEG, 6);
    out.lng = round(c.lng + x / (KM_PER_DEG * Math.cos((c.lat * Math.PI) / 180)), 6);
    out.heading = round(((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360, 2);
  }

  liveRow(i: number, t: number): unknown[] {
    const s = this.state(i, t) as unknown as Record<string, number>;
    return COMBINFO_LIVE_FIELDS.map((f) => s[f]);
  }

  snapshotRow(i: number, t: number): unknown[] {
    return [...this.metaRow(i), ...this.liveRow(i, t)];
  }

  /** Value of a lafparsed PID: dynamic PIDs follow the live state, the rest come from the sample. */
  pidValue(name: string, s: LiveState): number | null {
    switch (name) {
      case 'soc':
        return s.soc;
      case 'dte':
      case 'remaining_range':
        return s.dte;
      case 'odometer':
      case 'mcu_total_odo':
        return s.odometer;
      case 'mcu_speed':
        return s.speed;
      case 'current':
        return s.current;
      case 'mcu_charge_plug_status':
      case 'charger_status':
        return s.charging;
      case 'immobilization_status':
        return s.immobilization_status;
      default:
        return lafTemplate.candata[name]?.pidvalue ?? null;
    }
  }

  lafRow(i: number, t: number, pids: readonly string[]): unknown[] {
    const s = this.state(i, t);
    return [this.deviceId(i), s.canutctime, ...pids.map((p) => this.pidValue(p, s))];
  }

  // ---- vehicle-scope payloads ----

  combinfo(i: number, t: number): Combinfo {
    const s = this.state(i, t);
    const m = MODELS[this.model[i]!]!;
    const pid = (pidvalue: number): Pid => ({ pidvalue, valtype: 2, timestamp: s.canutctime });
    const tpl = combTemplate.parsedcandata;
    const kafkatime = s.utctime + 1765;
    return {
      deviceid: this.deviceId(i),
      vehicleid: this.vehicleId(i),
      regno: this.regno(i),
      chasiss: this.vin(i),
      assettypeid: m.assetTypeId,
      assettype: m.assetType,
      appmeta: {
        ...combTemplate.appmeta,
        Swapable: m.swappable,
        fueltype: m.fuelType,
        kwh: m.kwh,
        legacy_appmeta: { manufacturer: m.make, model: m.model, variant: m.variant },
        transmission: m.transmission,
        voltage: String(m.voltage),
      },
      proctime: kafkatime + 120,
      utctime: s.utctime,
      gpstime: s.gpstime,
      kafkatime,
      latitude: s.lat,
      longitude: s.lng,
      speed: s.speed,
      heading: s.heading,
      carbattery: s.carbattery,
      devbattery: s.devbattery,
      ignstatus: s.ignstatus,
      lastvalidfix: s.fixquality,
      fixquality: s.fixquality,
      devstate: combTemplate.devstate,
      rxdbm: s.rxdbm,
      lastignon: s.lastignon,
      lastignoff: s.lastignoff,
      canutctime: s.canutctime,
      parsedcandata: {
        current: pid(s.current),
        dte: pid(s.dte),
        engine_speed: pid(s.speed > 0 ? Math.round(s.speed * 45) : tpl.engine_speed.pidvalue),
        immobilization_status: pid(s.immobilization_status),
        motor_temperature: pid(tpl.motor_temperature.pidvalue + (s.ignstatus ? 18 : 0)),
        odometer: pid(s.odometer),
        soc: pid(s.soc),
        vehicle_mode_status: pid(tpl.vehicle_mode_status.pidvalue),
      },
    };
  }

  lafparsed(i: number, t: number): Lafparsed {
    const s = this.state(i, t);
    const candata: Record<string, Pid> = {};
    for (const { name, pid, age } of PID_ENTRIES) {
      const dynamic = DYNAMIC_PIDS.has(name);
      candata[name] = {
        pidvalue: dynamic ? this.pidValue(name, s)! : pid.pidvalue,
        valtype: pid.valtype,
        timestamp: dynamic ? s.canutctime : Math.max(0, s.canutctime - age),
      };
    }
    let plsign = '';
    for (let j = 0; j < 8; j++)
      plsign += hex8(hash32(this.seed + S.sign, i, (s.canutctime + j) | 0));
    const kafkatime = s.utctime + 1765;
    return {
      candata,
      deviceid: this.deviceId(i),
      kafkatime,
      msgtimestamp: s.canutctime,
      plsign,
      proctime: kafkatime + 140,
      uptime: s.utctime % (7 * DAY),
    };
  }

  /** `[lng, lat, ts]` at each report with a valid fix in `[from, to]`, oldest first. */
  trail(i: number, from: number, to: number): [number, number, number][] {
    const p = this.persona[i];
    if (p === PERSONA.gpsNever || p === PERSONA.noGps) return [];
    const points: [number, number, number][] = [];
    if (p === PERSONA.nonComm) {
      const r = this.reportAt(i, to);
      if (r >= from) {
        const s = this.stateAtReport(i, r);
        points.push([s.lng, s.lat, s.gpstime]);
      }
      return points;
    }
    for (let k = this.reportIndex(i, to); points.length < 20_000; k--) {
      const r = this.reportTime(i, k);
      if (r < from) break;
      const s = this.stateAtReport(i, r);
      points.push([s.lng, s.lat, s.gpstime]);
    }
    return points.reverse();
  }

  /** Moves a vehicle to another fleet (keeps per-fleet counts in sync). */
  moveTo(i: number, fleetIdx: number): void {
    this.tree.direct[this.fleet[i]!]!--;
    this.fleet[i] = fleetIdx;
    this.tree.direct[fleetIdx]!++;
  }
}
