import type { DriverMe, DriverRequest } from '@shared/contract/index.ts';
import { eventsSocket, type EventsSocket } from '@/features/notifications/events-socket';
import { createRequest, fetchDriverMe, fetchMyRequests, type NewRequest } from './api/driver-api';
import { mergeRequest } from './driver-model';

export const REFRESH_MS = 30_000;

export interface DriverState {
  me: DriverMe | null;
  requests: DriverRequest[];
  /** First load failed (shown with a retry). */
  error: unknown;
  /** "Replacement assigned: MH12…" (F13-R4), until dismissed. */
  banner: string | null;
}

export interface DriverStoreDeps {
  fetchMe: typeof fetchDriverMe;
  fetchRequests: typeof fetchMyRequests;
  create: typeof createRequest;
  socket: Pick<EventsSocket, 'onEvent' | 'onSync'>;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
}

const defaults: DriverStoreDeps = {
  fetchMe: fetchDriverMe,
  fetchRequests: fetchMyRequests,
  create: createRequest,
  socket: eventsSocket,
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (id) => globalThis.clearInterval(id as number),
};

/**
 * F13-R2/R4/R6: the driver page's main-thread store. Loads `/driver/me` + my requests, refreshes
 * every 30 s, merges WS `events` (scope `self`, via the shared F15 socket) and re-syncs over REST
 * after a reconnect. A replacement turning `assigned` reloads the vehicle and raises the banner.
 */
export class DriverStore {
  private state: DriverState = { me: null, requests: [], error: null, banner: null };
  private readonly listeners = new Set<() => void>();
  private readonly deps: DriverStoreDeps;
  private stops: (() => void)[] = [];

  constructor(deps: Partial<DriverStoreDeps> = {}) {
    this.deps = { ...defaults, ...deps };
  }

  getSnapshot = (): DriverState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Starts loading, polling and live events; returns the stop function. */
  start(): () => void {
    const { socket } = this.deps;
    void this.reload();
    const timer = this.deps.setInterval(() => void this.reloadMe(), REFRESH_MS);
    this.stops = [
      () => this.deps.clearInterval(timer),
      socket.onEvent('request', (r) => this.receive(r)),
      socket.onEvent('assignment', () => void this.reloadMe()),
      socket.onSync(({ reconnect }) => {
        if (reconnect) void this.reload();
      }),
    ];
    return () => {
      for (const stop of this.stops) stop();
      this.stops = [];
    };
  }

  async reload(): Promise<void> {
    try {
      const [me, page] = await Promise.all([this.deps.fetchMe(), this.deps.fetchRequests()]);
      let requests = page.items;
      for (const r of me.openRequests) requests = mergeRequest(requests, r);
      this.set({ me, requests, error: null });
    } catch (error) {
      if (!this.state.me) this.set({ error });
    }
  }

  async reloadMe(): Promise<void> {
    try {
      const me = await this.deps.fetchMe();
      let requests = this.state.requests;
      for (const r of me.openRequests) requests = mergeRequest(requests, r);
      this.set({ me, requests });
    } catch {
      // keep the last state; the next poll retries
    }
  }

  receive(r: DriverRequest): void {
    const prev = this.state.requests.find((x) => x.id === r.id);
    this.set({ requests: mergeRequest(this.state.requests, r) });
    if (r.type === 'replacement' && r.status === 'assigned' && prev?.status !== 'assigned')
      void this.reloadMe().then(() => {
        const regno = this.state.me?.vehicle?.meta.regno;
        this.set({ banner: `Replacement assigned: ${regno ?? 'new vehicle'}` });
      });
  }

  /** Sends a request; merges the created one. Throws `ApiError` (the sheet shows it). */
  async submit(body: NewRequest): Promise<DriverRequest> {
    const r = await this.deps.create(body);
    this.set({ requests: mergeRequest(this.state.requests, r) });
    return r;
  }

  dismissBanner(): void {
    this.set({ banner: null });
  }

  private set(patch: Partial<DriverState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of [...this.listeners]) l();
  }
}
