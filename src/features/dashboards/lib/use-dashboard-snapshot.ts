import { useEffect, useRef, type RefObject } from 'react';
import {
  dashboardSnapshotSchema,
  snapshotThemeSchema,
  type DashboardSnapshot,
} from '@shared/contract/dashboards.ts';
import { themeStore } from '@/shared/theme/theme-store';
import { gridReady, isSnapshotDue, type SnapshotMeta } from './snapshot-rules';

const CHECK_MS = 2000;
const RETRY_MS = 60_000;
const base = (id: string) => `/api/dashboards/${encodeURIComponent(id)}/snapshot`;

/** The caller's snapshot metadata (HEAD), `null` when none; throws on other failures. */
export async function headSnapshot(id: string, signal?: AbortSignal): Promise<SnapshotMeta | null> {
  const res = await fetch(base(id), { method: 'HEAD', credentials: 'include', signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HEAD snapshot ${res.status}`);
  const theme = snapshotThemeSchema.safeParse(res.headers.get('x-snapshot-theme'));
  const capturedAt = Number(res.headers.get('x-snapshot-captured-at'));
  return theme.success && Number.isFinite(capturedAt) ? { theme: theme.data, capturedAt } : null;
}

export async function uploadSnapshot(
  id: string,
  blob: Blob,
  theme: SnapshotMeta['theme'],
): Promise<DashboardSnapshot> {
  const res = await fetch(`${base(id)}?theme=${theme}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': blob.type },
    body: blob,
  });
  if (!res.ok) throw new Error(`PUT snapshot ${res.status}`);
  return dashboardSnapshotSchema.parse(await res.json());
}

const idle = (fn: () => void) =>
  typeof window.requestIdleCallback === 'function'
    ? window.requestIdleCallback(fn, { timeout: 3000 })
    : window.setTimeout(fn, 200);

/**
 * D-142: captures this viewer's view of the grid when a snapshot is due (none / > 10 min / other
 * theme / changed since) and the visible widgets have loaded, in an idle callback. Checks every
 * 2 s while the dashboard has widgets; one capture at a time; failures retry after 60 s.
 */
export function useDashboardSnapshot({
  id,
  updatedAt,
  hasWidgets,
  busy,
  rootRef,
}: {
  id: string;
  updatedAt: number | undefined;
  hasWidgets: boolean;
  /** A chat build or an unsaved local edit: wait. */
  busy: boolean;
  rootRef: RefObject<HTMLElement | null>;
}) {
  const latest = useRef({ updatedAt, busy });
  useEffect(() => {
    latest.current = { updatedAt, busy };
  }, [updatedAt, busy]);

  useEffect(() => {
    if (!hasWidgets) return;
    const abort = new AbortController();
    // `undefined` = not known yet (HEAD pending).
    let meta: SnapshotMeta | null | undefined;
    let inFlight = false;
    let failedAt = -Infinity;
    let stable = 0;
    headSnapshot(id, abort.signal).then(
      (m) => (meta = m),
      () => (meta = abort.signal.aborted ? undefined : null),
    );

    const capture = async (grid: HTMLElement, theme: SnapshotMeta['theme']) => {
      try {
        const { captureGrid } = await import('./snapshot-capture');
        if (abort.signal.aborted || !grid.isConnected || !gridReady(grid)) return;
        const blob = await captureGrid(grid);
        if (!blob || abort.signal.aborted) throw new Error('no image');
        const saved = await uploadSnapshot(id, blob, theme);
        meta = { capturedAt: saved.capturedAt, theme: saved.theme };
      } catch {
        failedAt = Date.now();
      } finally {
        inFlight = false;
        stable = 0;
      }
    };

    const tick = () => {
      const { updatedAt: changed, busy } = latest.current;
      const theme = themeStore().resolved();
      const now = Date.now();
      const grid = rootRef.current?.querySelector<HTMLElement>('[data-testid="dashboard-grid"]');
      if (
        meta === undefined ||
        inFlight ||
        busy ||
        document.hidden ||
        !grid ||
        now - failedAt < RETRY_MS ||
        !isSnapshotDue(meta, { now, theme, updatedAt: changed ?? 0 }) ||
        !gridReady(grid)
      ) {
        stable = 0;
        return;
      }
      if (++stable < 2) return;
      inFlight = true;
      idle(() => void capture(grid, theme));
    };
    const timer = window.setInterval(tick, CHECK_MS);
    return () => {
      abort.abort();
      window.clearInterval(timer);
    };
  }, [id, hasWidgets, rootRef]);
}
