/** Mock clock: wall time plus a dev-adjustable offset (`POST /api/dev/clock`). */
export class Clock {
  offsetMs = 0;
  now(): number {
    return Date.now() + this.offsetMs;
  }
}
