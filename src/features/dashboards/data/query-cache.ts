import { apiFetch } from '@/shared/api/api-client';
import type { WidgetRequest } from './widget-queries';

export interface CacheEntry {
  data: unknown;
  error: unknown;
  /** True while a request is in flight (the previous `data` stays shown). */
  loading: boolean;
  fetchedAt: number;
}

interface Slot {
  req: WidgetRequest;
  state: CacheEntry;
  listeners: Set<() => void>;
  ctrl: AbortController | null;
}

export interface QueryCacheDeps {
  fetch?: (url: string, signal: AbortSignal) => Promise<unknown>;
  now?: () => number;
}

const EMPTY: CacheEntry = { data: undefined, error: null, loading: true, fetchedAt: 0 };

/** Refresh interval of REST widgets (D-131). */
export const REFRESH_MS = 60_000;

/**
 * D-131: per-dashboard cache of REST widget data. Equal keys share one request; the last
 * unsubscribe aborts it; refreshes keep the previous data while loading.
 */
export class QueryCache {
  private slots = new Map<string, Slot>();
  private readonly fetchFn: (url: string, signal: AbortSignal) => Promise<unknown>;
  private readonly now: () => number;

  constructor(deps: QueryCacheDeps = {}) {
    this.fetchFn = deps.fetch ?? ((url, signal) => apiFetch(url, { signal }));
    this.now = deps.now ?? Date.now;
  }

  get(key: string): CacheEntry {
    return this.slots.get(key)?.state ?? EMPTY;
  }

  subscribe(req: WidgetRequest, listener: () => void): () => void {
    let slot = this.slots.get(req.key);
    if (!slot) {
      slot = { req, state: EMPTY, listeners: new Set(), ctrl: null };
      this.slots.set(req.key, slot);
      this.load(slot);
    }
    slot.listeners.add(listener);
    const s = slot;
    return () => {
      s.listeners.delete(listener);
      if (s.listeners.size) return;
      s.ctrl?.abort();
      this.slots.delete(req.key);
    };
  }

  /** Refetches one key, or every key. */
  refresh(key?: string): void {
    for (const slot of this.slots.values())
      if (key === undefined || slot.req.key === key) this.load(slot);
  }

  /** Refetches entries older than `maxAgeMs` (e.g. on returning to a hidden tab). */
  refreshStale(maxAgeMs = REFRESH_MS): void {
    const now = this.now();
    for (const slot of this.slots.values())
      if (!slot.state.loading && now - slot.state.fetchedAt >= maxAgeMs) this.load(slot);
  }

  get loading(): boolean {
    for (const slot of this.slots.values()) if (slot.state.loading) return true;
    return false;
  }

  dispose(): void {
    for (const slot of this.slots.values()) slot.ctrl?.abort();
    this.slots.clear();
  }

  private load(slot: Slot): void {
    slot.ctrl?.abort();
    const ctrl = new AbortController();
    slot.ctrl = ctrl;
    this.set(slot, { ...slot.state, loading: true });
    this.fetchFn(slot.req.url(this.now()), ctrl.signal).then(
      (data) => {
        if (ctrl.signal.aborted) return;
        slot.ctrl = null;
        this.set(slot, { data, error: null, loading: false, fetchedAt: this.now() });
      },
      (error: unknown) => {
        if (ctrl.signal.aborted) return;
        slot.ctrl = null;
        this.set(slot, { ...slot.state, error, loading: false, fetchedAt: this.now() });
      },
    );
  }

  private set(slot: Slot, state: CacheEntry): void {
    slot.state = state;
    for (const l of [...slot.listeners]) l();
  }
}
