import { unit } from './random.ts';

/** Most corners a route can have (city loop: 4 corners + up to 2 jogs × 2 points per side). */
export const MAX_POINTS = 24;
/** Share of vehicles on long arterial out-and-back trips (the rest loop through city streets). */
const ARTERIAL_SHARE = 0.2;

/**
 * Street-like routes for the mock (no road data): each city centre has one street-grid
 * orientation and block size, and every vehicle drives a closed route made of straight legs on
 * that grid, so tracks turn at right angles at "intersections" instead of curving freely.
 *
 * - **City loop** (80 %): a rectilinear loop of 3–16 × 3–16 blocks somewhere within 12 km of the
 *   centre; each side may jog one or two blocks around a "building" and come back.
 * - **Arterial trip** (20 %): an out-and-back run of 3–5 long legs (1.5–6 km each) along the
 *   grid's main axes, reaching 10–35 km out, then the same road back.
 *
 * Points are km offsets east (x) / north (y) of the centre, already rotated into the city grid.
 */
export class RoadRoutes {
  /** `[x0, y0, x1, y1, …]` per vehicle, `MAX_POINTS` slots each. */
  readonly xy: Float32Array;
  /** Cumulative length at each point (km); `cum[0] = 0`, last = closing point. */
  readonly cum: Float32Array;
  readonly n: Uint8Array;
  readonly total: Float32Array;

  constructor(count: number) {
    this.xy = new Float32Array(count * MAX_POINTS * 2);
    this.cum = new Float32Array(count * MAX_POINTS);
    this.n = new Uint8Array(count);
    this.total = new Float32Array(count);
  }

  /** Builds vehicle `i`'s route around centre `centre` (seeded by `seed`). */
  build(seed: number, i: number, centre: number): void {
    const r = (k: number) => unit(seed, i, k);
    const c = (k: number) => unit(seed, 100_000_000 + centre, k);
    // The city's grid: rotated −15…+15°, blocks of 250–600 m.
    const angle = (c(0) - 0.5) * (Math.PI / 6);
    const block = 0.25 + c(1) * 0.35;
    const pts = r(0) < ARTERIAL_SHARE ? arterial(r, block) : cityLoop(r, block);

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const base = i * MAX_POINTS;
    const count = Math.min(pts.length, MAX_POINTS);
    let len = 0;
    let px = 0;
    let py = 0;
    for (let k = 0; k < count; k++) {
      const [gx, gy] = pts[k]!;
      const x = gx * cos - gy * sin;
      const y = gx * sin + gy * cos;
      if (k > 0) len += Math.hypot(x - px, y - py);
      this.xy[(base + k) * 2] = x;
      this.xy[(base + k) * 2 + 1] = y;
      this.cum[base + k] = len;
      px = x;
      py = y;
    }
    // Close the loop back to the first point.
    const x0 = this.xy[base * 2]!;
    const y0 = this.xy[base * 2 + 1]!;
    len += Math.hypot(x0 - px, y0 - py);
    this.n[i] = count;
    this.total[i] = len;
  }

  /**
   * Position after `distKm` along vehicle `i`'s route (wrapping), written to `out` as km offsets
   * and the heading of the current leg (degrees clockwise from north).
   */
  at(i: number, distKm: number, out: { x: number; y: number; heading: number }): void {
    const n = this.n[i]!;
    const total = this.total[i]!;
    const base = i * MAX_POINTS;
    const d = total > 0 ? ((distKm % total) + total) % total : 0;
    let k = 0;
    while (k + 1 < n && this.cum[base + k + 1]! <= d) k++;
    const ax = this.xy[(base + k) * 2]!;
    const ay = this.xy[(base + k) * 2 + 1]!;
    const next = k + 1 < n ? k + 1 : 0;
    const bx = this.xy[(base + next) * 2]!;
    const by = this.xy[(base + next) * 2 + 1]!;
    const segEnd = k + 1 < n ? this.cum[base + k + 1]! : total;
    const seg = segEnd - this.cum[base + k]!;
    const f = seg > 0 ? (d - this.cum[base + k]!) / seg : 0;
    out.x = ax + (bx - ax) * f;
    out.y = ay + (by - ay) * f;
    out.heading = ((Math.atan2(bx - ax, by - ay) * 180) / Math.PI + 360) % 360;
  }
}

type Rand = (k: number) => number;
type Pt = [number, number];

/** A closed rectilinear loop on the city grid (km, unrotated). */
function cityLoop(r: Rand, block: number): Pt[] {
  // Where the loop sits: up to 12 km from the centre, snapped to an intersection.
  const dist = 0.5 + Math.sqrt(r(1)) * 11.5;
  const dir = r(2) * Math.PI * 2;
  const sx = Math.round((dist * Math.cos(dir)) / block);
  const sy = Math.round((dist * Math.sin(dir)) / block);
  const w = 3 + Math.floor(r(3) * 14);
  const h = 3 + Math.floor(r(4) * 14);
  const cw = r(5) < 0.5;
  // Corners in blocks, counter-clockwise from the start; reversed for clockwise.
  const corners: Pt[] = [
    [sx, sy],
    [sx + w, sy],
    [sx + w, sy + h],
    [sx, sy + h],
  ];
  if (cw) corners.reverse();
  const out: Pt[] = [];
  for (let side = 0; side < 4; side++) {
    const a = corners[side]!;
    const b = corners[(side + 1) % 4]!;
    out.push(a);
    const len = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
    if (len < 3 || r(10 + side) < 0.4) continue;
    // A jog: leave the side at j1, drive `depth` blocks over, come back at j2.
    const j1 = 1 + Math.floor(r(20 + side) * (len - 2));
    const j2 = j1 + 1 + Math.floor(r(30 + side) * (len - j1 - 1));
    const depth = (r(40 + side) < 0.5 ? -1 : 1) * (1 + Math.floor(r(50 + side) * 2));
    const ux = Math.sign(b[0] - a[0]);
    const uy = Math.sign(b[1] - a[1]);
    // Perpendicular to the side.
    const px = -uy * depth;
    const py = ux * depth;
    const p1: Pt = [a[0] + ux * j1, a[1] + uy * j1];
    const p2: Pt = [a[0] + ux * j2, a[1] + uy * j2];
    out.push(p1, [p1[0] + px, p1[1] + py], [p2[0] + px, p2[1] + py], p2);
  }
  return out.map(([x, y]) => [x * block, y * block]);
}

/** An out-and-back trip along the grid's main axes, starting near the centre (km, unrotated). */
function arterial(r: Rand, block: number): Pt[] {
  const snap = (v: number) => Math.round(v / block) * block;
  const start: Pt = [snap((r(1) - 0.5) * 4), snap((r(2) - 0.5) * 4)];
  // Heading out mostly one way (a quadrant), alternating east-west and north-south legs.
  const sx = r(3) < 0.5 ? -1 : 1;
  const sy = r(4) < 0.5 ? -1 : 1;
  const legs = 3 + Math.floor(r(5) * 3);
  const out: Pt[] = [start];
  let [x, y] = start;
  for (let k = 0; k < legs; k++) {
    const len = snap(1.5 + r(10 + k) * 4.5 * (k === 0 ? 1 : 1.6));
    if ((k + (r(6) < 0.5 ? 0 : 1)) % 2 === 0) x += sx * len;
    else y += sy * len;
    out.push([x, y]);
  }
  // The same road back (the loop closes on `start`).
  for (let k = out.length - 2; k >= 1; k--) out.push(out[k]!);
  return out;
}
