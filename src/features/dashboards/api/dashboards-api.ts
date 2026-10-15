import {
  dashboardListSchema,
  dashboardSchema,
  dashboardShareListSchema,
  shareCandidateListSchema,
  WIDGETS_PER_DASHBOARD,
  type Dashboard,
  type DashboardList,
  type DashboardShare,
  type ShareCandidate,
  type UpdateDashboardBody,
  type Widget,
} from '@shared/contract/dashboards.ts';
import { ApiError, apiFetch } from '@/shared/api/api-client';

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

/**
 * D-135 (global panel): appends a preview's widget to a dashboard the user owns. A plain owner
 * save (`version`); on a 409 it re-reads and tries again (nothing local to lose). The server
 * places the widget at the first free spot.
 */
export async function addWidgetToDashboard(
  api: Pick<DashboardsApi, 'get' | 'patch'>,
  id: string,
  widget: Widget,
): Promise<Dashboard> {
  for (let attempt = 0; ; attempt++) {
    const d = await api.get(id);
    if (d.widgets.some((w) => w.id === widget.id)) return d;
    if (d.widgets.length >= WIDGETS_PER_DASHBOARD)
      throw new ApiError(
        422,
        'dashboard_limit',
        `A dashboard can hold up to ${WIDGETS_PER_DASHBOARD} widgets`,
      );
    try {
      return await api.patch(id, { version: d.version, widgets: [...d.widgets, widget] });
    } catch (err) {
      if (attempt < 2 && err instanceof ApiError && err.status === 409) continue;
      throw err;
    }
  }
}
