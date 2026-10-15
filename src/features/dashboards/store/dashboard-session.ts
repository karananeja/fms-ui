import {
  BREAKPOINT_IDS,
  DASHBOARD_BREAKPOINTS,
  WIDGET_SIZES,
  WIDGETS_PER_DASHBOARD,
  type Dashboard,
  type DashboardBreakpoint,
  type DashboardLayout,
  type LayoutItem,
  type UpdateDashboardBody,
  type Widget,
} from '@shared/contract/dashboards.ts';
import { ApiError } from '@/shared/api/api-client';
import type { DashboardsApi } from '../api/dashboards-api';
import { rebaseLayout, sameLayout, sanitizeItems, type LooseItem } from '../lib/layout';

/** `pending` = a debounced or queued change not sent yet (shown as "Saving…"). */
export type SaveState = 'saved' | 'pending' | 'saving' | 'error' | 'offline';

export interface SessionState {
  status: 'loading' | 'ready' | 'not-found' | 'error';
  /** Server state with the pending edits applied (what the page shows). */
  dashboard: Dashboard | null;
  saveState: SaveState;
  lastError: unknown;
  /** Bumps on each 409 soft reload (the page shows the notice). */
  noticeVersion: number;
}

type Op =
  | { kind: 'title'; title: string }
  | { kind: 'widget-title'; id: string; title: string }
  | { kind: 'remove'; id: string }
  | { kind: 'restore'; widgets: Widget[]; layout: DashboardLayout }
  | { kind: 'layout'; layout: DashboardLayout }
  | { kind: 'add'; widget: Widget; at: AddAt | null; settle: Settle };

/** D-135: a drop on the grid: the breakpoint's whole layout as the grid left it (new item included). */
export interface AddAt {
  bp: DashboardBreakpoint;
  items: readonly LooseItem[];
}

interface Settle {
  resolve(): void;
  reject(err: unknown): void;
}

/** The add op's layout: the dropped breakpoint as given, the others with the widget at the bottom. */
function layoutWithAdded(
  layout: DashboardLayout,
  widget: Widget,
  at: AddAt | null,
  ids: ReadonlySet<string>,
): DashboardLayout {
  const out = {} as DashboardLayout;
  for (const bp of BREAKPOINT_IDS) {
    if (at && at.bp === bp) {
      out[bp] = sanitizeItems(
        at.items.filter((it) => ids.has(it.i) || it.i === widget.id),
        bp,
      );
      continue;
    }
    const items = layout[bp].filter((it) => it.i !== widget.id);
    const { cols } = DASHBOARD_BREAKPOINTS[bp];
    const size = WIDGET_SIZES[widget.type];
    const w = bp === 'sm' ? 1 : Math.min(size.w, cols);
    const y = items.reduce((m, it) => Math.max(m, it.y + it.h), 0);
    const item: LayoutItem = {
      i: widget.id,
      x: 0,
      y,
      w,
      h: size.h,
      minW: Math.min(size.minW, w),
      minH: size.minH,
    };
    out[bp] = [...items, item];
  }
  return out;
}

export const LAYOUT_DEBOUNCE_MS = 800;
/** Automatic retries after a network/5xx failure (2, 4, 8 s), then a manual Retry. */
export const RETRY_DELAYS_MS = [2000, 4000, 8000];

const ids = (d: Dashboard) => d.widgets.map((w) => w.id);

/** The op applied locally on top of `d` (optimistic display). */
function applyOp(d: Dashboard, op: Op): Dashboard {
  switch (op.kind) {
    case 'title':
      return { ...d, title: op.title };
    case 'widget-title':
      return {
        ...d,
        widgets: d.widgets.map((w) => (w.id === op.id ? { ...w, title: op.title } : w)),
      };
    case 'remove': {
      const keep = (i: string) => i !== op.id;
      return {
        ...d,
        widgets: d.widgets.filter((w) => keep(w.id)),
        layout: {
          lg: d.layout.lg.filter((it) => keep(it.i)),
          md: d.layout.md.filter((it) => keep(it.i)),
          sm: d.layout.sm.filter((it) => keep(it.i)),
        },
      };
    }
    case 'restore':
      return { ...d, widgets: op.widgets, layout: op.layout };
    case 'layout':
      return { ...d, layout: rebaseLayout(op.layout, d.layout, ids(d)) };
    case 'add': {
      const widgets = [...d.widgets.filter((w) => w.id !== op.widget.id), op.widget];
      const layout = layoutWithAdded(d.layout, op.widget, op.at, new Set(ids(d)));
      return { ...d, widgets, layout };
    }
  }
}

/** The PATCH body for `op` against the latest server state (rebased at send time). */
function bodyOf(server: Dashboard, op: Op): Omit<UpdateDashboardBody, 'version'> {
  switch (op.kind) {
    case 'title':
      return { title: op.title };
    case 'widget-title':
    case 'remove':
      return { widgets: applyOp(server, op).widgets };
    case 'restore':
      return { widgets: op.widgets, layout: op.layout };
    case 'layout':
      return { layout: rebaseLayout(op.layout, server.layout, ids(server)) };
    case 'add': {
      // Without a drop position the server places it (first free spot at the bottom).
      const next = applyOp(server, op);
      return op.at ? { widgets: next.widgets, layout: next.layout } : { widgets: next.widgets };
    }
  }
}

const settleOf = (op: Op | undefined) => (op?.kind === 'add' ? op.settle : null);

/**
 * D-130 / §5: one open dashboard. Every PATCH goes through one serial queue with the latest
 * `version`; edits are optimistic; layout saves are debounced 800 ms and coalesced; a 409 soft-
 * reloads (no merge); network/5xx retries 2/4/8 s, then waits for a manual Retry.
 */
export class DashboardSession {
  private server: Dashboard | null = null;
  private queue: Op[] = [];
  private inFlight: { op: Op; sentVersion: number } | null = null;
  private debounced: DashboardLayout | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private failed: 'error' | 'offline' | null = null;
  private status: SessionState['status'] = 'loading';
  private lastError: unknown = null;
  private noticeVersion = 0;
  private loadSeq = 0;
  private snap: SessionState;
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly id: string,
    private readonly api: Pick<DashboardsApi, 'get' | 'patch'>,
  ) {
    this.snap = this.compute();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SessionState => this.snap;

  /** Latest server version (for chat Undo). */
  get version(): number {
    return this.server?.version ?? 0;
  }

  async load(): Promise<void> {
    const seq = ++this.loadSeq;
    try {
      const d = await this.api.get(this.id);
      if (seq !== this.loadSeq) return;
      this.server = d;
      this.status = 'ready';
    } catch (err) {
      if (seq !== this.loadSeq) return;
      const e = err instanceof ApiError ? err : null;
      this.status = e && (e.status === 404 || e.status === 403) ? 'not-found' : 'error';
      this.lastError = err;
      if (this.status === 'not-found') this.server = null;
    }
    this.emit();
  }

  // ---- edits ----

  setTitle(title: string): void {
    this.enqueue({ kind: 'title', title });
  }

  setWidgetTitle(id: string, title: string): void {
    this.enqueue({ kind: 'widget-title', id, title });
  }

  /** Optimistic removal; returns the Undo (re-PATCHes the previous widgets + layout). */
  removeWidget(id: string): () => void {
    const before = this.snap.dashboard;
    this.enqueue({ kind: 'remove', id });
    return () => {
      if (before) this.enqueue({ kind: 'restore', widgets: before.widgets, layout: before.layout });
    };
  }

  /**
   * D-135: adds a chat preview's widget (Add, or a drop on the grid at `at`). A normal owner save
   * through the queue (version / 409 rules); resolves once saved, rejects when it is dropped.
   */
  addWidget(widget: Widget, at: AddAt | null = null): Promise<void> {
    const current = this.snap.dashboard;
    if (!this.server || !current)
      return Promise.reject(new ApiError(0, 'not_ready', 'The dashboard is still loading'));
    if (current.widgets.some((w) => w.id === widget.id)) return Promise.resolve();
    if (current.widgets.length >= WIDGETS_PER_DASHBOARD)
      return Promise.reject(
        new ApiError(
          422,
          'dashboard_limit',
          `A dashboard can hold up to ${WIDGETS_PER_DASHBOARD} widgets`,
        ),
      );
    // A pending drag/resize goes first so the drop lands on the layout the user sees.
    this.flush();
    return new Promise<void>((resolve, reject) =>
      this.enqueue({ kind: 'add', widget, at, settle: { resolve, reject } }),
    );
  }

  /** A drag/resize stop or keyboard drop: saved after `LAYOUT_DEBOUNCE_MS`, coalesced. */
  scheduleLayout(layout: DashboardLayout): void {
    const current = this.snap.dashboard;
    if (!current || sameLayout(layout, current.layout)) return;
    this.debounced = layout;
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.flush(), LAYOUT_DEBOUNCE_MS);
    this.emit();
  }

  /** Sends a pending debounced layout now (route leave, tab hidden). */
  flush(): void {
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    const layout = this.debounced;
    this.debounced = null;
    if (layout) this.enqueue({ kind: 'layout', layout });
  }

  /** Manual Retry after failures. */
  retry(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.attempt = 0;
    this.failed = null;
    this.emit();
    this.pump();
  }

  /**
   * §8: a newer dashboard from the chat (or Undo). Taken at once; pending edits stay queued and
   * are rebased when sent; an older version (a late response) is ignored.
   */
  adoptRemote(d: Dashboard): void {
    if (this.server && d.version <= this.server.version) return;
    this.server = d;
    this.status = 'ready';
    this.emit();
  }

  dispose(): void {
    this.flush();
  }

  // ---- queue ----

  private enqueue(op: Op): void {
    if (!this.server) return;
    if (op.kind === 'layout' || op.kind === 'title') {
      const same = this.queue.findIndex((q) => q.kind === op.kind);
      if (same >= 0) this.queue.splice(same, 1);
    }
    this.queue.push(op);
    this.emit();
    this.pump();
  }

  private pump(): void {
    if (this.inFlight || this.failed || !this.server) return;
    const op = this.queue.shift();
    if (!op) return;
    const server = this.server;
    this.inFlight = { op, sentVersion: server.version };
    this.emit();
    this.api.patch(this.id, { version: server.version, ...bodyOf(server, op) }).then(
      (d) => this.landed(d),
      (err: unknown) => this.failedWith(op, err),
    );
  }

  private landed(d: Dashboard): void {
    settleOf(this.inFlight?.op)?.resolve();
    this.inFlight = null;
    this.attempt = 0;
    if (!this.server || d.version > this.server.version) this.server = d;
    this.emit();
    this.pump();
  }

  private failedWith(op: Op, err: unknown): void {
    const sent = this.inFlight?.sentVersion ?? 0;
    this.inFlight = null;
    this.lastError = err;
    const e = err instanceof ApiError ? err : new ApiError(0, 'network', String(err));
    if (e.status === 409 && this.server && this.server.version > sent) {
      // A newer remote version arrived meanwhile: send again, rebased on it.
      this.queue.unshift(op);
      this.pump();
      return;
    }
    if (e.unreachable) {
      this.queue.unshift(op);
      const delay = RETRY_DELAYS_MS[this.attempt];
      this.attempt++;
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      this.failed = offline ? 'offline' : 'error';
      if (delay !== undefined)
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          this.failed = null;
          this.emit();
          this.pump();
        }, delay);
      this.emit();
      return;
    }
    // 409 (changed elsewhere), 403/404 (no longer yours), 422: drop local edits and reload.
    settleOf(op)?.reject(err);
    for (const q of this.queue) settleOf(q)?.reject(err);
    this.queue = [];
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    this.debounced = null;
    if (e.status === 409) this.noticeVersion++;
    this.emit();
    void this.load();
  }

  // ---- state ----

  private compute(): SessionState {
    let dashboard = this.server;
    if (dashboard) {
      if (this.inFlight) dashboard = applyOp(dashboard, this.inFlight.op);
      for (const op of this.queue) dashboard = applyOp(dashboard, op);
      if (this.debounced)
        dashboard = applyOp(dashboard, { kind: 'layout', layout: this.debounced });
    }
    const saveState: SaveState = this.failed
      ? this.failed
      : this.inFlight
        ? 'saving'
        : this.queue.length || this.debounced
          ? 'pending'
          : 'saved';
    return {
      status: this.status,
      dashboard,
      saveState,
      lastError: this.lastError,
      noticeVersion: this.noticeVersion,
    };
  }

  private emit(): void {
    this.snap = this.compute();
    for (const l of [...this.listeners]) l();
  }
}
