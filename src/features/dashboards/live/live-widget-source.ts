import type {
  LiveWidgetBatch,
  LiveWidgetQuery,
  LiveWidgetResult,
} from '@/features/live-tracking/worker/worker-api';

/** What the source needs from the live-tracking store (a passthrough to the worker). */
export interface LiveQueryPort {
  readonly running: boolean;
  queryWidgets(queries: LiveWidgetQuery[], sinceVersion?: number): Promise<LiveWidgetBatch | null>;
}

export interface LiveWidgetState {
  /** `unavailable`: the worker isn't running (no `live.view`). */
  status: 'loading' | 'ready' | 'unavailable';
  result: LiveWidgetResult | null;
}

interface Entry {
  query: LiveWidgetQuery;
  state: LiveWidgetState;
  json: string;
  listeners: Set<() => void>;
}

export const LIVE_POLL_MS = 1000;
const LOADING: LiveWidgetState = { status: 'loading', result: null };

export const liveQueryKey = (q: LiveWidgetQuery) => JSON.stringify(q);

/**
 * D-129: one page-level poller for every live widget. Calls the worker at most once per
 * `LIVE_POLL_MS` while the page is visible; widgets re-render only when their result changed.
 */
export class LiveWidgetSource {
  private entries = new Map<string, Entry>();
  private version: number | undefined;
  private keysAsked = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;

  constructor(
    private readonly port: LiveQueryPort,
    private readonly opts: { intervalMs?: number; hidden?: () => boolean } = {},
  ) {}

  get(key: string): LiveWidgetState {
    return this.entries.get(key)?.state ?? LOADING;
  }

  register(query: LiveWidgetQuery, listener: () => void): () => void {
    const key = liveQueryKey(query);
    let e = this.entries.get(key);
    if (!e) {
      e = { query, state: LOADING, json: '', listeners: new Set() };
      this.entries.set(key, e);
      this.keysAsked = ''; // a new entry needs a full answer
    }
    e.listeners.add(listener);
    this.schedule(0);
    const entry = e;
    return () => {
      entry.listeners.delete(listener);
      if (!entry.listeners.size) this.entries.delete(key);
    };
  }

  /** Stops polling (re-registering starts it again, e.g. after a StrictMode remount). */
  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  /** One poll (exported for tests). */
  async poll(): Promise<void> {
    if (this.busy) return;
    const hidden = this.opts.hidden ?? (() => typeof document !== 'undefined' && document.hidden);
    if (!this.entries.size || hidden()) return;
    if (!this.port.running) {
      for (const e of this.entries.values())
        this.update(e, { status: 'unavailable', result: null }, 'unavailable');
      return;
    }
    const keys = [...this.entries.keys()];
    const joined = keys.join('\n');
    const since = joined === this.keysAsked ? this.version : undefined;
    this.busy = true;
    try {
      const batch = await this.port.queryWidgets(
        keys.map((k) => this.entries.get(k)!.query),
        since,
      );
      if (!batch) return;
      this.version = batch.version;
      this.keysAsked = joined;
      if (!batch.ready) {
        this.keysAsked = ''; // ask again in full once the snapshot completes
        return;
      }
      if (!batch.results) return;
      batch.results.forEach((result, n) => {
        const e = this.entries.get(keys[n]!);
        if (e) this.update(e, { status: 'ready', result }, JSON.stringify(result));
      });
    } finally {
      this.busy = false;
    }
  }

  private update(e: Entry, state: LiveWidgetState, json: string): void {
    if (e.json === json) return;
    e.json = json;
    e.state = state;
    for (const l of [...e.listeners]) l();
  }

  private schedule(ms: number): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.poll().finally(() => {
        if (this.entries.size) this.schedule(this.opts.intervalMs ?? LIVE_POLL_MS);
      });
    }, ms);
  }
}
