import type { DashboardList } from '@shared/contract/dashboards.ts';
import type { DashboardsApi } from '../api/dashboards-api';

export interface ListState {
  status: 'loading' | 'ready' | 'error';
  data: DashboardList | null;
  error: unknown;
}

/** Refetch on window focus only when older than this. */
export const LIST_STALE_MS = 30_000;

/** §3: the `/dashboards` lists; refetched on mount, on focus when stale and on dashboard events. */
export class DashboardListStore {
  private state: ListState = { status: 'loading', data: null, error: null };
  private fetchedAt = 0;
  private seq = 0;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly api: Pick<DashboardsApi, 'list'>,
    private readonly now: () => number = Date.now,
  ) {}

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = () => this.state;

  async load(): Promise<void> {
    const seq = ++this.seq;
    if (!this.state.data) this.set({ ...this.state, status: 'loading' });
    try {
      const data = await this.api.list();
      if (seq !== this.seq) return;
      this.fetchedAt = this.now();
      this.set({ status: 'ready', data, error: null });
    } catch (error) {
      if (seq !== this.seq) return;
      this.set({ ...this.state, status: this.state.data ? 'ready' : 'error', error });
    }
  }

  loadIfStale(): void {
    if (this.now() - this.fetchedAt > LIST_STALE_MS) void this.load();
  }

  /** Optimistic local edits (rename, delete, share count) until the next fetch. */
  patch(fn: (d: DashboardList) => DashboardList): void {
    if (this.state.data) this.set({ ...this.state, data: fn(this.state.data) });
  }

  private set(state: ListState): void {
    this.state = state;
    for (const l of [...this.listeners]) l();
  }
}
