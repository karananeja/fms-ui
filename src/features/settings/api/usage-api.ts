import type { UsageRange, UsageReport } from '@shared/contract/index.ts';
import { ApiError, apiFetch } from '@/shared/api/api-client';

/** F30 usage calls: the caller's own runs, and (with `roles.manage`) the whole organisation. */

interface Opts {
  signal?: AbortSignal;
}

export const getMyUsage = (range: UsageRange, opts: Opts = {}) =>
  apiFetch<UsageReport>(`/api/me/usage?range=${range}`, { signal: opts.signal });

export interface OrgUsageFilter {
  range: UsageRange;
  userId?: string;
  provider?: string;
}

const orgQuery = (f: OrgUsageFilter) => {
  const p = new URLSearchParams({ range: f.range });
  if (f.userId) p.set('userId', f.userId);
  if (f.provider) p.set('provider', f.provider);
  return p.toString();
};

export const getOrgUsage = (f: OrgUsageFilter, opts: Opts = {}) =>
  apiFetch<UsageReport>(`/api/admin/usage?${orgQuery(f)}`, { signal: opts.signal });

/** The CSV body of `GET /api/admin/usage.csv` (a plain fetch: the body is not JSON). */
export async function fetchUsageCsv(f: OrgUsageFilter): Promise<string> {
  const res = await fetch(`/api/admin/usage.csv?${orgQuery(f)}`, { credentials: 'include' });
  if (!res.ok) throw new ApiError(res.status, 'http_error', `Export failed (HTTP ${res.status})`);
  return res.text();
}
