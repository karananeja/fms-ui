/**
 * F23: the `/dashboards` list state lives in the URL (tab, search, sort, view) so a reload or
 * "← Dashboards" from a dashboard comes back to the same list. Imported by the router: keep
 * this file free of UI imports.
 */
import type { DashboardSummary } from '@shared/contract/dashboards.ts';

export const LIST_SORTS = ['recent', 'name', 'widgets'] as const;
export type ListSort = (typeof LIST_SORTS)[number];

export interface ListSearch {
  tab?: 'shared';
  q?: string;
  /** `recent` (the default) is omitted. */
  sort?: Exclude<ListSort, 'recent'>;
  /** `grid` (the default) is omitted. */
  view?: 'list';
}

export const LIST_Q_MAX = 80;

export function parseListSearch(s: Record<string, unknown>): ListSearch {
  const out: ListSearch = {};
  if (s.tab === 'shared') out.tab = 'shared';
  if (typeof s.q === 'string' && s.q.trim()) out.q = s.q.slice(0, LIST_Q_MAX);
  if (s.sort === 'name' || s.sort === 'widgets') out.sort = s.sort;
  if (s.view === 'list') out.view = 'list';
  return out;
}

/** Search (title, description, owner) then sort; `recent` = last updated first. */
export function arrange(
  list: readonly DashboardSummary[],
  q: string,
  sort: ListSort,
): DashboardSummary[] {
  const needle = q.trim().toLowerCase();
  const hits = needle
    ? list.filter((d) =>
        [d.title, d.description, d.ownerName].some((s) => s.toLowerCase().includes(needle)),
      )
    : [...list];
  const byName = (a: DashboardSummary, b: DashboardSummary) =>
    a.title.localeCompare(b.title, 'en', { sensitivity: 'base' });
  return hits.sort((a, b) =>
    sort === 'name'
      ? byName(a, b)
      : sort === 'widgets'
        ? b.widgetCount - a.widgetCount || byName(a, b)
        : b.updatedAt - a.updatedAt,
  );
}

const KEY = 'fms.dashboards.list';
let last: ListSearch = {};

/** The list page records its search on every change. */
export function rememberListSearch(s: ListSearch): void {
  last = s;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage unavailable: keep the in-memory copy only
  }
}

/** The list search to go back to (this tab's last one, else the default list). */
export function lastListSearch(): ListSearch {
  if (Object.keys(last).length) return last;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) return parseListSearch(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    // unreadable: fall back to the default list
  }
  return {};
}
