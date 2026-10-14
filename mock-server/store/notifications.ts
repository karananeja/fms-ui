import type { Notification, Permission, User } from '@shared/contract/index.ts';
import type { MockContext } from '../context.ts';
import { PERSONA } from '../generator/vehicle-sim.ts';

const MIN = 60_000;
export const NO_GPS_ALERT_MS = 24 * 60 * MIN;
/** The 24 h no-GPS job runs once per (mock-clock) minute. */
export const NO_GPS_JOB_MS = MIN;

/** Who may see a notification or a WS event (F11 §3 visibility). */
export interface Audience {
  fleetId: string;
  /** Staff holding any of these, with `fleetId` in their scope. */
  staff: readonly Permission[];
  /** The driver (index) who also sees it, or -1. */
  driver: number;
}

export function staffSees(
  ctx: MockContext,
  user: User,
  perms: readonly Permission[],
  a: Audience,
): boolean {
  return a.staff.some((p) => perms.includes(p)) && ctx.tree.inScope(a.fleetId, user.fleetIds);
}

export function driverSees(
  ctx: MockContext,
  user: User,
  perms: readonly Permission[],
  a: Audience,
): boolean {
  return (
    a.driver >= 0 && perms.includes('driver.self') && ctx.drivers.byUserId(user.id) === a.driver
  );
}

interface NotificationRecord extends Omit<Notification, 'readAt'> {
  seq: number;
  audience: Audience;
}

interface ReadState {
  at: Map<string, number>;
  /** "Mark all read": everything up to this sequence number, at this time. */
  allSeq: number;
  allAt: number;
}

/** Notifications, per-user read state and the 24 h no-GPS job (memory only). */
export class Notifications {
  private readonly items: NotificationRecord[] = [];
  private readonly reads = new Map<string, ReadState>();
  /** `${vehicle}:${since}` of every no-GPS episode already notified. */
  private readonly episodes = new Set<string>();
  private noGpsVehicles?: Int32Array;
  private seq = 0;
  private timer?: NodeJS.Timeout;

  constructor(private readonly ctx: MockContext) {}

  start(): void {
    this.timer = setInterval(() => this.tick(), NO_GPS_JOB_MS);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  get size(): number {
    return this.items.length;
  }

  add(
    n: Omit<Notification, 'id' | 'readAt' | 'createdAt'> & { createdAt?: number },
    audience: Audience,
  ): Notification {
    const seq = ++this.seq;
    const record: NotificationRecord = {
      ...n,
      id: `ntf-${seq}`,
      createdAt: n.createdAt ?? this.ctx.clock.now(),
      seq,
      audience,
    };
    this.items.push(record);
    const dto = this.toDto(record, null);
    this.ctx.hub?.publish('notification', dto, audience);
    return dto;
  }

  private toDto(n: NotificationRecord, readAt: number | null): Notification {
    const { seq, audience, ...dto } = n;
    void seq;
    void audience;
    return { ...dto, readAt };
  }

  visible(user: User, perms: readonly Permission[], n: NotificationRecord): boolean {
    return (
      staffSees(this.ctx, user, perms, n.audience) || driverSees(this.ctx, user, perms, n.audience)
    );
  }

  private readAt(userId: string, n: NotificationRecord): number | null {
    const r = this.reads.get(userId);
    if (!r) return null;
    return r.at.get(n.id) ?? (n.seq <= r.allSeq ? r.allAt : null);
  }

  /** Visible notifications, newest first; `cursor` is the last seen `seq`. */
  list(
    user: User,
    perms: readonly Permission[],
    opts: { unread?: boolean; cursor?: string; limit: number },
  ) {
    const before = opts.cursor === undefined ? Infinity : Number(opts.cursor);
    const items: Notification[] = [];
    let unreadCount = 0;
    let more = false;
    let lastSeq = 0;
    for (let k = this.items.length - 1; k >= 0; k--) {
      const n = this.items[k]!;
      if (!this.visible(user, perms, n)) continue;
      const readAt = this.readAt(user.id, n);
      if (readAt === null) unreadCount++;
      if (n.seq >= before || (opts.unread && readAt !== null)) continue;
      if (items.length < opts.limit) {
        items.push(this.toDto(n, readAt));
        lastSeq = n.seq;
      } else more = true;
    }
    return {
      items,
      nextCursor: more ? String(lastSeq) : null,
      unreadCount,
    };
  }

  markRead(user: User, perms: readonly Permission[], body: { ids?: string[]; all?: true }) {
    const now = this.ctx.clock.now();
    let r = this.reads.get(user.id);
    if (!r) this.reads.set(user.id, (r = { at: new Map(), allSeq: 0, allAt: 0 }));
    if (body.all) {
      r.allSeq = this.seq;
      r.allAt = now;
    } else {
      const ids = new Set(body.ids);
      for (const n of this.items) {
        if (ids.has(n.id) && this.visible(user, perms, n) && this.readAt(user.id, n) === null)
          r.at.set(n.id, now);
      }
    }
    return { unreadCount: this.list(user, perms, { limit: 1 }).unreadCount };
  }

  /**
   * The 24 h no-GPS job: one `no-gps-24h` per vehicle-episode once the episode's age passes 24 h
   * (mock clock, D-038; `POST /dev/clock` runs it at once). Returns how many were raised.
   */
  tick(now = this.ctx.clock.now()): number {
    const { sim, requests } = this.ctx;
    if (!this.noGpsVehicles) {
      const list: number[] = [];
      for (let i = 0; i < sim.count; i++) if (sim.persona[i] === PERSONA.noGps) list.push(i);
      this.noGpsVehicles = Int32Array.from(list);
    }
    const due: [number, number][] = [];
    for (const i of this.noGpsVehicles) {
      const since = sim.noGpsSince(i, now);
      if (now - since <= NO_GPS_ALERT_MS) continue;
      const key = `${i}:${since}`;
      if (this.episodes.has(key)) continue;
      this.episodes.add(key);
      due.push([i, since]);
    }
    due.sort((a, b) => a[1] - b[1]);
    for (const [i, since] of due) {
      const fleetId = sim.fleetId(i);
      this.add(
        {
          kind: 'no-gps-24h',
          severity: 'critical',
          title: `${sim.regno(i)} has had no GPS for 24 hours`,
          body: 'No GPS fix for over 24 hours. Open the vehicle to see the likely cause.',
          fleetId,
          vehicleId: sim.vehicleId(i),
          createdAt: since + NO_GPS_ALERT_MS,
        },
        { fleetId, staff: ['live.view'], driver: -1 },
      );
    }
    requests?.reevaluate();
    return due.length;
  }
}
