import type { Fleet } from '@shared/contract/index.ts';
import { toast } from 'sonner';
import {
  DEFAULT_SORT,
  TABLE_COLUMNS,
  type TableColumnId,
  type TableSort,
} from '../config/table-columns.ts';
import type { Bbox, TableResult } from '../worker/worker-api.ts';
import type { TableScope } from '../worker/table-query.ts';
import { liveTrackingStore, type LiveTrackingStore } from './live-tracking-store.ts';

export type TableLayout = 'desktop' | 'mobile';

export interface TableViewState {
  open: boolean;
  scope: TableScope;
  /** Map bbox captured when the table opened (viewport scope). */
  bbox: Bbox | null;
  sort: TableSort;
  /** Visible columns, in table order. */
  columns: TableColumnId[];
  /** The window the table asked for, and the rows the worker returned for it. */
  offset: number;
  limit: number;
  result: TableResult | null;
  paused: boolean;
  /** Live updates that arrived while paused. */
  pending: number;
  exporting: boolean;
  /** Fleet id → name (`GET /api/fleets`), also used by the vehicle tray. */
  fleetNames: Readonly<Record<string, string>>;
}

export interface TableViewDeps {
  fetchFleets?: () => Promise<Fleet[]>;
  download?: (blob: Blob, filename: string) => void;
  now?: () => number;
}

const columnsKey = (layout: TableLayout) => `fms.table.columns.${layout}`;

export const defaultColumns = (layout: TableLayout): TableColumnId[] =>
  TABLE_COLUMNS.filter((c) => c[layout]).map((c) => c.id);

function readColumns(layout: TableLayout): TableColumnId[] {
  try {
    const raw = JSON.parse(localStorage.getItem(columnsKey(layout)) ?? 'null') as unknown;
    if (Array.isArray(raw)) {
      const ids = new Set(raw);
      const cols = TABLE_COLUMNS.filter((c) => ids.has(c.id)).map((c) => c.id);
      if (cols.length) return cols;
    }
  } catch {
    // Unreadable or unavailable storage: defaults.
  }
  return defaultColumns(layout);
}

function writeColumns(layout: TableLayout, columns: TableColumnId[]): void {
  try {
    localStorage.setItem(columnsKey(layout), JSON.stringify(columns));
  } catch {
    // Storage unavailable: the choice lasts for this page only.
  }
}

const istParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** `fleet-vehicles-YYYYMMDD-HHmm.csv` in IST (F09-R5). */
export function csvFilename(epochMs: number): string {
  const p: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const { type, value } of istParts.formatToParts(epochMs)) p[type] = value;
  return `fleet-vehicles-${p.year}${p.month}${p.day}-${p.hour}${p.minute}.csv`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function fetchFleets(): Promise<Fleet[]> {
  const res = await fetch('/api/fleets', { credentials: 'include' });
  return res.ok ? ((await res.json()) as Fleet[]) : [];
}

const initial: TableViewState = {
  open: false,
  scope: 'all',
  bbox: null,
  sort: DEFAULT_SORT,
  columns: defaultColumns('desktop'),
  offset: 0,
  limit: 100,
  result: null,
  paused: false,
  pending: 0,
  exporting: false,
  fleetNames: {},
};

/**
 * F09 table state (main thread). Sorting, windowing and CSV run in the worker; this keeps the
 * small UI state, re-queries the visible window on each live push (≤ 4 Hz) and handles Pause.
 */
export class TableViewStore {
  private state: TableViewState = initial;
  private readonly listeners = new Set<() => void>();
  private layout: TableLayout = 'desktop';
  private unsubscribeLive: (() => void) | null = null;
  private inFlight = false;
  private again = false;
  private namesLoaded = false;

  constructor(
    private readonly live: LiveTrackingStore = liveTrackingStore,
    private readonly deps: TableViewDeps = {},
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): TableViewState => this.state;

  /** Shows the table: captures the map bbox for the viewport scope and starts live re-queries. */
  open(layout: TableLayout): void {
    if (this.state.open) return;
    this.layout = layout;
    this.set({
      ...this.state,
      open: true,
      bbox: this.live.viewportBbox,
      columns: readColumns(layout),
      paused: false,
      pending: 0,
    });
    let stats = this.live.getSnapshot().stats;
    this.unsubscribeLive = this.live.subscribe(() => {
      const next = this.live.getSnapshot().stats;
      if (next === stats) return; // not a push
      stats = next;
      if (this.state.paused) this.set({ ...this.state, pending: this.state.pending + 1 });
      else void this.refresh();
    });
    void this.loadFleetNames();
    void this.refresh();
  }

  close(): void {
    this.unsubscribeLive?.();
    this.unsubscribeLive = null;
    if (this.state.open) this.set({ ...this.state, open: false, result: null });
  }

  /** The rows the table needs (visible range + buffer). */
  setRange(offset: number, limit: number): void {
    if (offset === this.state.offset && limit === this.state.limit) return;
    this.set({ ...this.state, offset, limit });
    void this.refresh(true);
  }

  /** Header click: same column flips the direction, another column sorts ascending. */
  toggleSort(column: TableColumnId): void {
    const { sort } = this.state;
    const dir = sort.column === column && sort.dir === 'asc' ? 'desc' : 'asc';
    this.set({ ...this.state, sort: { column, dir }, offset: 0 });
    void this.refresh(true);
  }

  setScope(scope: TableScope): void {
    if (scope === this.state.scope) return;
    this.set({ ...this.state, scope, offset: 0 });
    void this.refresh(true);
  }

  toggleColumn(id: TableColumnId): void {
    const on = new Set(this.state.columns);
    if (on.has(id)) {
      if (on.size === 1) return; // keep at least one column
      on.delete(id);
    } else on.add(id);
    const columns = TABLE_COLUMNS.filter((c) => on.has(c.id)).map((c) => c.id);
    writeColumns(this.layout, columns);
    this.set({ ...this.state, columns });
  }

  togglePause(): void {
    const paused = !this.state.paused;
    this.set({ ...this.state, paused, pending: 0 });
    if (!paused) void this.refresh(true);
  }

  /** F09-R5: the worker builds the CSV of exactly what the table shows; progress in a toast. */
  async exportCsv(): Promise<void> {
    if (this.state.exporting) return;
    const { scope, bbox, sort, columns } = this.state;
    this.set({ ...this.state, exporting: true });
    const id = toast.loading('Exporting CSV… 0%');
    try {
      const res = await this.live.exportCsv({ scope, bbox, sort, columns }, (done, total) =>
        toast.loading(`Exporting CSV… ${total ? Math.round((done / total) * 100) : 100}%`, { id }),
      );
      if (!res) throw new Error('worker unavailable');
      (this.deps.download ?? downloadBlob)(res.blob, csvFilename((this.deps.now ?? Date.now)()));
      toast.success(`Exported ${res.rows.toLocaleString('en-IN')} rows`, { id });
    } catch {
      toast.error('Export failed', { id });
    } finally {
      this.set({ ...this.state, exporting: false });
    }
  }

  /** Re-queries the current window; coalesces while a query is in flight. */
  async refresh(force = false): Promise<void> {
    if (!this.state.open || (this.state.paused && !force)) return;
    if (this.inFlight) {
      this.again = true;
      return;
    }
    this.inFlight = true;
    try {
      const { scope, bbox, sort, offset, limit } = this.state;
      const result = await this.live.queryTable({ scope, bbox, sort, offset, limit });
      const now = this.state;
      // Drop replies for a window/sort/scope that changed meanwhile (the follow-up query fixes it).
      if (result && now.open && now.scope === scope && now.sort === sort && now.offset === offset)
        this.set({ ...now, result });
    } finally {
      this.inFlight = false;
      if (this.again) {
        this.again = false;
        void this.refresh(true);
      }
    }
  }

  /** Loads fleet names once (table Fleet column, CSV, tray); later calls are no-ops. */
  async loadFleetNames(): Promise<void> {
    if (this.namesLoaded) return;
    this.namesLoaded = true;
    const fleets = await (this.deps.fetchFleets ?? fetchFleets)().catch(() => []);
    if (!fleets.length) {
      this.namesLoaded = false;
      return;
    }
    const fleetNames = Object.fromEntries(fleets.map((f) => [f.id, f.name]));
    this.set({ ...this.state, fleetNames });
    await this.live.setFleetNames(fleetNames);
    void this.refresh(true);
  }

  private set(state: TableViewState): void {
    if (state === this.state) return;
    this.state = state;
    for (const l of this.listeners) l();
  }
}

export const tableViewStore = new TableViewStore();
