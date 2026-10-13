import type { Combinfo } from '@shared/contract/index.ts';
import type { VehicleStatus } from '@shared/domain/vehicle-status.ts';
import { isValidPosition } from './position.ts';

/** One selected-vehicle payload sample (null = value missing). */
export interface HistorySample {
  t: number;
  soc: number | null;
  speed: number | null;
  lat: number | null;
  lng: number | null;
}

export type HistoryEventKind = 'status' | 'ignition-on' | 'ignition-off';

/** An observed status transition or a reported ignition change. Nothing is inferred. */
export interface HistoryEvent {
  t: number;
  kind: HistoryEventKind;
  /** New status (`status` events) or the status when the ignition event was seen. */
  status: VehicleStatus | null;
  /** Status before the transition (`status` events only). */
  from: VehicleStatus | null;
  soc: number | null;
  lat: number | null;
  lng: number | null;
}

export interface SessionHistory {
  samples: HistorySample[];
  /** Oldest first. */
  events: HistoryEvent[];
}

const num = (v: number | undefined | null) =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** Per-selection ring buffer (≤ `maxMs` of samples) and event log; reset on each new selection. */
export class SelectedHistory {
  private samples: HistorySample[] = [];
  private events: HistoryEvent[] = [];
  private status: VehicleStatus | null = null;
  private ignition = new Set<string>();
  private last: Combinfo | null = null;

  constructor(private readonly maxMs: number) {}

  reset(): void {
    this.samples = [];
    this.events = [];
    this.status = null;
    this.ignition.clear();
    this.last = null;
  }

  /** A fresh `combinfo` payload: one sample (by `utctime`) and any new ignition times. */
  addPayload(c: Combinfo, status: VehicleStatus | null): void {
    this.last = c;
    const t = c.utctime;
    const tail = this.samples.at(-1);
    if (Number.isFinite(t) && (!tail || t > tail.t)) {
      const pos = isValidPosition(c.latitude, c.longitude);
      this.samples.push({
        t,
        soc: num(c.parsedcandata.soc?.pidvalue),
        speed: num(c.speed),
        lat: pos ? c.latitude : null,
        lng: pos ? c.longitude : null,
      });
      const cutoff = t - this.maxMs;
      let drop = 0;
      while (drop < this.samples.length && this.samples[drop]!.t < cutoff) drop++;
      if (drop) this.samples.splice(0, drop);
    }
    this.ignitionEvent('ignition-on', c.lastignon, status);
    this.ignitionEvent('ignition-off', c.lastignoff, status);
  }

  /** The derived status now; a change from the last observed one is recorded once. */
  observeStatus(status: VehicleStatus | null, now: number): boolean {
    if (status === this.status) return false;
    const from = this.status;
    this.status = status;
    if (from === null || status === null) return false;
    this.push({ t: now, kind: 'status', status, from });
    return true;
  }

  view(): SessionHistory {
    return { samples: this.samples.slice(), events: this.events.slice() };
  }

  private ignitionEvent(kind: HistoryEventKind, t: number, status: VehicleStatus | null): void {
    if (!Number.isFinite(t) || t <= 0) return;
    const key = `${kind}:${t}`;
    if (this.ignition.has(key)) return;
    this.ignition.add(key);
    this.push({ t, kind, status, from: null });
  }

  private push(e: Pick<HistoryEvent, 't' | 'kind' | 'status' | 'from'>): void {
    const c = this.last;
    const pos = c && isValidPosition(c.latitude, c.longitude);
    const event: HistoryEvent = {
      ...e,
      soc: num(c?.parsedcandata.soc?.pidvalue),
      lat: pos ? c.latitude : null,
      lng: pos ? c.longitude : null,
    };
    let k = this.events.length;
    while (k > 0 && this.events[k - 1]!.t > event.t) k--;
    this.events.splice(k, 0, event);
  }
}
