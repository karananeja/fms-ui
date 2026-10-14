import type { DriverRequest, Fleet, RequestStatus, RequestType } from '@shared/contract/index.ts';
import {
  buildFleetIndex,
  isInSubtree,
  type FleetIndex,
} from '@/features/access/fleets/fleet-tree-model';
import { can } from '@/features/access/permissions/can';
import { sessionStore } from '@/features/auth/session/session-store';
import {
  eventsSocket,
  type EventsSocket,
  type SessionSource,
} from '@/features/notifications/events-socket';
import { listRequests, type RequestListQuery, type RequestPage } from './api/requests-api';
import { isOpenRequest } from './lib/request-model';

export type TypeFilter = 'all' | RequestType;
/** `open` = every non-terminal status (the default). */
export type StatusFilter = 'open' | 'all' | RequestStatus;

export interface DeskFilter {
  type: TypeFilter;
  status: StatusFilter;
  fleetId: string | null;
  /** Reg no or driver name (substring, any case). */
  q: string;
}

export type DeskStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface DeskState {
  status: DeskStatus;
  /** Every request in scope, newest first, unique by id. */
  items: readonly DriverRequest[];
  /** `items` through `filter`. */
  rows: readonly DriverRequest[];
  filter: DeskFilter;
  /** Open (non-terminal) requests in scope: the nav badge. */
  openCount: number;
  /** Ids updated by a live event a moment ago (row highlight). */
  highlighted: ReadonlySet<string>;
  /** Bumped when a label (reg no, driver name) arrives. */
  labelsVersion: number;
}

export interface DeskStoreDeps {
  session: SessionSource;
  socket: Pick<EventsSocket, 'onEvent' | 'onSync'>;
  list: (q: RequestListQuery) => Promise<RequestPage>;
  /** How long a live-updated row stays highlighted. */
  highlightMs?: number;
}

export const DEFAULT_FILTER: DeskFilter = { type: 'all', status: 'open', fleetId: null, q: '' };
const PAGE = 500;
/** Safety cap on pages per load (the mock keeps requests in memory; real scale is small). */
const MAX_PAGES = 20;

const initial: DeskState = {
  status: 'idle',
  items: [],
  rows: [],
  filter: DEFAULT_FILTER,
  openCount: 0,
  highlighted: new Set(),
  labelsVersion: 0,
};

const newestFirst = (a: DriverRequest, b: DriverRequest) =>
  b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1);

/**
 * F14 / D-101: the operator request desk on the main thread (low volume, not the fleet worker).
 * Loads every request in the user's scope, keeps it live from the shared F15 `events` socket
 * (`request` events upsert by id; a reconnect re-loads over REST) and filters in memory, so a
 * row enters or leaves the filtered set as its status changes. The nav badge and the desk page
 * share it; it follows the session while retained, only for users with `requests.manage`.
 */
export class RequestDeskStore {
  private state: DeskState = initial;
  private readonly listeners = new Set<() => void>();
  private readonly labels = new Map<string, string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private fleetIndex: FleetIndex | null = null;
  private retainCount = 0;
  private offSession: (() => void) | null = null;
  private offSocket: (() => void)[] = [];
  private userId: string | null = null;
  private gen = 0;

  constructor(private readonly deps: DeskStoreDeps) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): DeskState => this.state;

  /** Follows the session (and listens to `events`) until every release. */
  retain(): () => void {
    if (this.retainCount++ === 0) {
      this.offSession = this.deps.session.subscribe(this.followSession);
      this.followSession();
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.retainCount > 0) return;
      this.offSession?.();
      this.offSession = null;
      this.switchUser(null);
    };
  }

  /** Every request in scope again (also "Retry" and the re-sync after a reconnect). */
  async reload(): Promise<void> {
    const gen = this.gen;
    if (!this.userId) return;
    if (this.state.status !== 'ready') this.set({ status: 'loading' });
    try {
      const loaded: DriverRequest[] = [];
      let cursor: string | undefined;
      for (let p = 0; p < MAX_PAGES; p++) {
        const page = await this.deps.list({ cursor, limit: PAGE });
        if (gen !== this.gen) return;
        loaded.push(...page.items);
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      // Live updates that raced the load win when they are newer.
      const byId = new Map(loaded.map((r) => [r.id, r]));
      for (const r of this.state.items) {
        const l = byId.get(r.id);
        if (!l || r.updatedAt > l.updatedAt) byId.set(r.id, r);
      }
      this.setItems([...byId.values()].sort(newestFirst), { status: 'ready' });
    } catch {
      if (gen === this.gen) this.set({ status: this.state.status === 'ready' ? 'ready' : 'error' });
    }
  }

  /** Inserts or updates one request (a live event, or this tab's own action result). */
  upsert(r: DriverRequest, highlight = true): void {
    const items = this.state.items;
    const k = items.findIndex((x) => x.id === r.id);
    if (k >= 0 && items[k]!.updatedAt > r.updatedAt) return;
    const next = k >= 0 ? items.map((x, i) => (i === k ? r : x)) : [r, ...items].sort(newestFirst);
    let highlighted = this.state.highlighted;
    if (highlight) {
      highlighted = new Set(highlighted).add(r.id);
      clearTimeout(this.timers.get(r.id));
      this.timers.set(
        r.id,
        setTimeout(() => {
          this.timers.delete(r.id);
          const h = new Set(this.state.highlighted);
          h.delete(r.id);
          this.set({ highlighted: h });
        }, this.deps.highlightMs ?? 2500),
      );
    }
    this.setItems(next, { highlighted });
  }

  get(id: string): DriverRequest | undefined {
    return this.state.items.find((r) => r.id === id);
  }

  setFilter(patch: Partial<DeskFilter>): void {
    const filter = { ...this.state.filter, ...patch };
    this.set({ filter, rows: this.filtered(this.state.items, filter) });
  }

  /** The fleet tree for the subtree filter. */
  setFleets(fleets: readonly Fleet[]): void {
    this.fleetIndex = buildFleetIndex(fleets);
    this.setFilter({});
  }

  /** A searchable label for a vehicle or driver id (reg no, driver name). */
  setLabel(id: string, text: string): void {
    if (this.labels.get(id) === text) return;
    this.labels.set(id, text);
    this.set({
      labelsVersion: this.state.labelsVersion + 1,
      rows: this.state.filter.q
        ? this.filtered(this.state.items, this.state.filter)
        : this.state.rows,
    });
  }

  label(id: string): string | undefined {
    return this.labels.get(id);
  }

  fleetName(fleetId: string): string | undefined {
    return this.fleetIndex?.byId.get(fleetId)?.name;
  }

  /** The driver's open replacement request, if any (the breakdown drawer links to it). */
  openReplacementFor(driverId: string): DriverRequest | undefined {
    return this.state.items.find(
      (r) => r.driverId === driverId && r.type === 'replacement' && isOpenRequest(r),
    );
  }

  /** The open breakdown on a vehicle, if loaded (no-GPS insight link). */
  openBreakdown(vehicleId: string): DriverRequest | undefined {
    return this.state.items.find(
      (r) => r.vehicleId === vehicleId && r.type === 'breakdown' && isOpenRequest(r),
    );
  }

  private filtered(items: readonly DriverRequest[], f: DeskFilter): DriverRequest[] {
    const q = f.q.trim().toLowerCase();
    const index = this.fleetIndex;
    return items.filter((r) => {
      if (f.type !== 'all' && r.type !== f.type) return false;
      if (f.status === 'open' ? !isOpenRequest(r) : f.status !== 'all' && r.status !== f.status)
        return false;
      if (
        f.fleetId &&
        r.fleetId !== f.fleetId &&
        !(index && isInSubtree(index, r.fleetId, f.fleetId))
      )
        return false;
      if (q) {
        const hay = [r.vehicleId, this.labels.get(r.vehicleId), this.labels.get(r.driverId)];
        if (!hay.some((s) => s?.toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }

  private setItems(items: DriverRequest[], patch: Partial<DeskState> = {}): void {
    this.set({
      ...patch,
      items,
      rows: this.filtered(items, this.state.filter),
      openCount: items.filter(isOpenRequest).length,
    });
  }

  private followSession = (): void => {
    const { status, me } = this.deps.session.getSnapshot();
    const ok = status === 'authenticated' && me && can(me, 'requests.manage');
    this.switchUser(ok ? me.user.id : null);
  };

  private switchUser(userId: string | null): void {
    if (userId === this.userId) return;
    this.gen++;
    for (const off of this.offSocket) off();
    this.offSocket = [];
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.labels.clear();
    this.userId = userId;
    this.set(initial);
    if (!userId) return;
    const { socket } = this.deps;
    this.offSocket.push(
      socket.onEvent('request', (r) => this.upsert(r)),
      socket.onSync(({ reconnect }) => {
        if (reconnect) void this.reload();
      }),
    );
    void this.reload();
  }

  private set(patch: Partial<DeskState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
}

export const requestDeskStore = new RequestDeskStore({
  session: sessionStore,
  socket: eventsSocket,
  list: (q) => listRequests(q),
});
