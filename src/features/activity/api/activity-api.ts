import type { ActionCard, AuditPage, AuditQuery } from '@shared/contract/index.ts';
import { apiFetch } from '@/shared/api/api-client';

/** F29: audit query string (empty values left out). */
export function auditSearch(q: Partial<AuditQuery>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const listAudit = (q: Partial<AuditQuery>, opts: { signal?: AbortSignal } = {}) =>
  apiFetch<AuditPage>(`/api/audit${auditSearch(q)}`, { signal: opts.signal });

/** The CSV download URL for the same filters (the server sends `activity.csv`). */
export const auditCsvUrl = (q: Partial<AuditQuery>) =>
  `/api/audit.csv${auditSearch({ ...q, before: undefined })}`;

export const confirmAction = (id: string) =>
  apiFetch<ActionCard>(`/api/actions/${encodeURIComponent(id)}/confirm`, { method: 'POST' });
export const cancelAction = (id: string) =>
  apiFetch<ActionCard>(`/api/actions/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
export const undoAction = (id: string) =>
  apiFetch<ActionCard>(`/api/actions/${encodeURIComponent(id)}/undo`, { method: 'POST' });
export const getAction = (id: string, opts: { signal?: AbortSignal } = {}) =>
  apiFetch<ActionCard>(`/api/actions/${encodeURIComponent(id)}`, { signal: opts.signal });
