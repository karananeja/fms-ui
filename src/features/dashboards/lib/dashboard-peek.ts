import { useEffect, useState, type RefObject } from 'react';
import type { DashboardSummary } from '@shared/contract/dashboards.ts';
import type { DashboardsApi } from '../api/dashboards-api';

/** F23: what a list card draws: the `lg` layout boxes with their widget types. */
export interface DashboardPeek {
  items: { x: number; y: number; w: number; h: number; type: string }[];
  types: string[];
}

const EMPTY: DashboardPeek = { items: [], types: [] };
const MAX_PARALLEL = 4;

const done = new Map<string, DashboardPeek | null>();
const pending = new Map<string, Promise<DashboardPeek | null>>();
const queue: (() => void)[] = [];
let running = 0;

function next(): void {
  while (running < MAX_PARALLEL && queue.length) {
    running++;
    queue.shift()!();
  }
}

/**
 * The summary has no layout or widget types (contract unchanged), so a card reads its dashboard
 * once it scrolls into view: at most 4 at a time, cached per id + version for the session.
 */
export function loadPeek(
  api: Pick<DashboardsApi, 'get'>,
  d: Pick<DashboardSummary, 'id' | 'version'>,
): Promise<DashboardPeek | null> {
  const key = `${d.id}@${d.version}`;
  if (done.has(key)) return Promise.resolve(done.get(key)!);
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const p = new Promise<DashboardPeek | null>((resolve) => {
    queue.push(() => {
      api
        .get(d.id)
        .then(
          (full) => {
            const types = new Map(full.widgets.map((w) => [w.id, w.type as string]));
            const items = full.layout.lg
              .filter((it) => types.has(it.i))
              .map((it) => ({ x: it.x, y: it.y, w: it.w, h: it.h, type: types.get(it.i)! }));
            return { items, types: [...new Set(full.widgets.map((w) => w.type as string))] };
          },
          () => null,
        )
        .then((peek) => {
          done.set(key, peek);
          pending.delete(key);
          running--;
          resolve(peek);
          next();
        });
    });
    next();
  });
  pending.set(key, p);
  return p;
}

/** The card's peek: loaded when `ref` is near the viewport; `undefined` until then. */
export function useDashboardPeek(
  api: Pick<DashboardsApi, 'get'> | undefined,
  d: Pick<DashboardSummary, 'id' | 'version' | 'widgetCount'>,
  ref: RefObject<Element | null>,
): DashboardPeek | null | undefined {
  const key = `${d.id}@${d.version}`;
  const [got, setGot] = useState<{ key: string; peek: DashboardPeek | null } | null>(null);
  const empty = d.widgetCount === 0;
  useEffect(() => {
    const node = ref.current;
    if (empty || !api || done.has(key) || !node || typeof IntersectionObserver === 'undefined')
      return;
    let live = true;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        void loadPeek(api, d).then((peek) => live && setGot({ key, peek }));
      },
      { rootMargin: '200px' },
    );
    io.observe(node);
    return () => {
      live = false;
      io.disconnect();
    };
    // `d` is identified by its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, key, empty, ref]);
  if (empty) return EMPTY;
  if (got?.key === key) return got.peek;
  return done.get(key);
}

/** Tests: forget cached peeks. */
export function resetPeeks(): void {
  done.clear();
  pending.clear();
}
