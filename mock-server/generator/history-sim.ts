import { IST_OFFSET_MS, KPI_FIELDS, type Kpis } from '@shared/contract/index.ts';
import { MODELS } from './catalogue.ts';
import { hash32, unit } from './random.ts';
import { CHARGE_FROM, DRIVE_END, PERSONA, type VehicleSim } from './vehicle-sim.ts';

const HOUR = 3_600_000;
export const DAY_MS = 24 * HOUR;
/** Accumulator slots, in `KPI_FIELDS` order. */
export const K = Object.fromEntries(KPI_FIELDS.map((f, i) => [f, i])) as Record<
  (typeof KPI_FIELDS)[number],
  number
>;
export const KPI_COUNT = KPI_FIELDS.length;
/** Diesel energy as kWh-equivalent per km (~0.28 L/km × 9.9 kWh/L). */
const DIESEL_KWH_PER_KM = 2.8;
/** Harsh events per 100 km for a style-1.0 vehicle. */
const RATE = { harshBrake: 1.5, harshAccel: 1.2, overspeed: 0.8 } as const;

const S = { day: 201, events: 202, style: 203 } as const;

const bump = (out: Float64Array, slot: number, v: number) => {
  out[slot] = out[slot]! + v;
};

/** IST day number of an instant, and the instant that day starts (IST midnight). */
export const istDay = (t: number) => Math.floor((t + IST_OFFSET_MS) / DAY_MS);
export const istDayStart = (day: number) => day * DAY_MS - IST_OFFSET_MS;
export const istDate = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

/**
 * Closed-form daily aggregates per vehicle and IST day (D-094). Each (vehicle, day) costs two
 * hashes and no per-sample stepping: the duty cycle (`DRIVE_END`, `CHARGE_FROM`), the vehicle's
 * speed and SOC swing come from `VehicleSim`; day-level noise and persona weights do the rest.
 */
export class HistorySim {
  /** Driving style per vehicle (0.3–2.5, scales harsh-event rates). */
  private readonly style: Float32Array;
  private readonly kwhPerKm: Float32Array;
  /** kWh one charge session puts back (EVs), else 0. */
  private readonly kwhPerCharge: Float32Array;

  constructor(private readonly sim: VehicleSim) {
    const n = sim.count;
    this.style = new Float32Array(n);
    this.kwhPerKm = new Float32Array(n);
    this.kwhPerCharge = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = unit(sim.seed + S.style, i);
      // Skewed: most vehicles drive smoothly, a tail drives hard.
      this.style[i] = 0.3 + 2.2 * u * u;
      const m = MODELS[sim.model[i]!]!;
      const kwh = Number(m.kwh);
      const ev = m.fuelType === 'EV';
      this.kwhPerKm[i] = ev ? kwh / m.rangeKm : DIESEL_KWH_PER_KM;
      this.kwhPerCharge[i] = ev ? (kwh * sim.socDrop[i]!) / 100 : 0;
    }
  }

  /** Adds `w` × vehicle `i`'s aggregates for IST day `day` into `out[off … off + KPI_COUNT)`. */
  addDay(i: number, day: number, w: number, out: Float64Array, off = 0): void {
    const sim = this.sim;
    const seed = sim.seed;
    const persona = sim.persona[i]!;
    const h1 = hash32(seed + S.day, i, day);
    const h2 = hash32(seed + S.events, i, day);
    const u0 = (h1 & 0xffff) / 65536;
    const u1 = (h1 >>> 16) / 65536;
    const b0 = (h2 & 0xff) / 256;
    const b1 = ((h2 >>> 8) & 0xff) / 256;
    const b2 = ((h2 >>> 16) & 0xff) / 256;
    const b3 = (h2 >>> 24) / 256;

    const sunday = (day + 4) % 7 === 0;
    const dayFactor = (0.7 + 0.4 * u0) * (sunday ? 0.7 : 1);
    const pBreak = persona === PERSONA.pullout || persona === PERSONA.immobilized ? 0.03 : 0.004;
    const breakdown = u1 < pBreak ? 1 : 0;
    const breakdownMs = breakdown ? (2 + 6 * (u1 / pBreak)) * HOUR : 0;
    const offline = persona === PERSONA.nonComm ? 0.3 + 0.5 * b3 : 0;
    const active = (1 - offline) * (breakdown ? 0.5 : 1);
    const ev = this.kwhPerCharge[i]! > 0;

    const driveMs = DRIVE_END * DAY_MS * dayFactor * active;
    const chargeMs = ev ? (1 - CHARGE_FROM) * DAY_MS * dayFactor * active : 0;
    // Offline + breakdown + charging can overlap; cap so the day still adds up to 24 h.
    const downtimeMs = Math.min(chargeMs + breakdownMs + offline * DAY_MS, DAY_MS - driveMs);
    const idleMs = DAY_MS - driveMs - downtimeMs;
    const distanceKm = (driveMs / HOUR) * sim.speedKmh[i]!;
    const energyKwh = distanceKm * this.kwhPerKm[i]!;
    const per100 = (distanceKm / 100) * this.style[i]!;
    const noGpsMs =
      persona === PERSONA.gpsNever
        ? DAY_MS
        : persona === PERSONA.noGps
          ? (0.2 + 0.8 * b3) * DAY_MS
          : b3 < 0.04
            ? (b3 / 0.04) * 2 * HOUR
            : 0;

    bump(out, off + K.distanceKm, w * distanceKm);
    bump(out, off + K.driveMs, w * driveMs);
    bump(out, off + K.idleMs, w * idleMs);
    bump(out, off + K.uptimeMs, w * (driveMs + idleMs));
    bump(out, off + K.downtimeMs, w * downtimeMs);
    bump(out, off + K.noGpsMs, w * noGpsMs);
    bump(out, off + K.energyKwh, w * energyKwh);
    bump(out, off + K.chargeSessions, w * (ev ? Math.round(energyKwh / this.kwhPerCharge[i]!) : 0));
    bump(out, off + K.breakdowns, w * breakdown);
    bump(out, off + K.harshBrake, w * Math.floor(per100 * RATE.harshBrake + b0));
    bump(out, off + K.harshAccel, w * Math.floor(per100 * RATE.harshAccel + b1));
    bump(out, off + K.overspeed, w * Math.floor(per100 * RATE.overspeed + b2));
  }

  /**
   * Adds vehicle `i` over `[from, to)` (partial days weighted by overlap). With `baseDay`, each
   * day goes to its own block `out[(day − baseDay) × KPI_COUNT …]`; otherwise all into `out[0 …]`.
   */
  addRange(i: number, from: number, to: number, out: Float64Array, baseDay?: number): void {
    if (to <= from) return;
    const last = istDay(to - 1);
    for (let day = istDay(from); day <= last; day++) {
      const start = istDayStart(day);
      const w = (Math.min(to, start + DAY_MS) - Math.max(from, start)) / DAY_MS;
      this.addDay(i, day, w, out, baseDay === undefined ? 0 : (day - baseDay) * KPI_COUNT);
    }
  }
}

/** Rounded `Kpis` from accumulator slots (durations to whole ms, counts to integers). */
export function toKpis(acc: Float64Array, off = 0): Kpis {
  const v = (f: (typeof KPI_FIELDS)[number]) => Math.max(0, acc[off + K[f]]!);
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    distanceKm: r1(v('distanceKm')),
    driveMs: Math.round(v('driveMs')),
    idleMs: Math.round(v('idleMs')),
    uptimeMs: Math.round(v('uptimeMs')),
    downtimeMs: Math.round(v('downtimeMs')),
    noGpsMs: Math.round(v('noGpsMs')),
    energyKwh: r1(v('energyKwh')),
    chargeSessions: Math.round(v('chargeSessions')),
    breakdowns: Math.round(v('breakdowns')),
    harshBrake: Math.round(v('harshBrake')),
    harshAccel: Math.round(v('harshAccel')),
    overspeed: Math.round(v('overspeed')),
  };
}
