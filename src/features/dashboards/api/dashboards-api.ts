import {
  dashboardListSchema,
  dashboardSchema,
  dashboardShareListSchema,
  shareCandidateListSchema,
  type Dashboard,
  type DashboardList,
  type DashboardShare,
  type ShareCandidate,
  type UpdateDashboardBody,
} from '@shared/contract/dashboards.ts';
import { apiFetch } from '@/shared/api/api-client';

/** F20: zod-parsed wrappers over the F18 dashboard REST routes. */
export interface DashboardsApi {
  list(signal?: AbortSignal): Promise<DashboardList>;
  get(id: string, signal?: AbortSignal): Promise<Dashboard>;
  create(): Promise<Dashboard>;
  patch(id: string, body: UpdateDashboardBody): Promise<Dashboard>;
  duplicate(id: string): Promise<Dashboard>;
  remove(id: string): Promise<void>;
  shares(id: string, signal?: AbortSignal): Promise<DashboardShare[]>;
  addShares(id: string, userIds: string[]): Promise<DashboardShare[]>;
  revokeShare(id: string, userId: string): Promise<void>;
  candidates(q: string, signal?: AbortSignal): Promise<ShareCandidate[]>;
}

const base = (id: string) => `/api/dashboards/${encodeURIComponent(id)}`;

export const dashboardsApi: DashboardsApi = {
  list: async (signal) => dashboardListSchema.parse(await apiFetch('/api/dashboards', { signal })),
  get: async (id, signal) => dashboardSchema.parse(await apiFetch(base(id), { signal })),
  create: async () => dashboardSchema.parse(await apiFetch('/api/dashboards', { body: {} })),
  patch: async (id, body) =>
    dashboardSchema.parse(await apiFetch(base(id), { method: 'PATCH', body })),
  duplicate: async (id) =>
    dashboardSchema.parse(await apiFetch(`${base(id)}/duplicate`, { body: {} })),
  remove: async (id) => {
    await apiFetch(base(id), { method: 'DELETE' });
  },
  shares: async (id, signal) =>
    dashboardShareListSchema.parse(await apiFetch(`${base(id)}/shares`, { signal })),
  addShares: async (id, userIds) =>
    dashboardShareListSchema.parse(await apiFetch(`${base(id)}/shares`, { body: { userIds } })),
  revokeShare: async (id, userId) => {
    await apiFetch(`${base(id)}/shares/${encodeURIComponent(userId)}`, { method: 'DELETE' });
  },
  candidates: async (q, signal) =>
    shareCandidateListSchema.parse(
      await apiFetch(`/api/dashboards/share-candidates?${new URLSearchParams(q ? { q } : {})}`, {
        signal,
      }),
    ),
};
