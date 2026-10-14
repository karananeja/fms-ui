import type {
  DriverRequest,
  FleetSettings,
  NoGpsInsight,
  ReplacementCandidate,
  RequestAction,
  RequestStatus,
  RequestType,
} from '@shared/contract/index.ts';
import { query } from '@/features/drivers/api/drivers-api';
import { apiFetch } from '@/shared/api/api-client';

/**
 * F14: typed calls for the F11 request endpoints. Every call throws `ApiError` on non-2xx;
 * 409 `invalid_transition` = the request changed meanwhile, 409 `conflict` = the vehicle can't
 * be used (the message says why), 422 = validation.
 */

interface Opts {
  signal?: AbortSignal;
}

export interface RequestListQuery {
  type?: RequestType;
  status?: RequestStatus;
  fleetId?: string;
  cursor?: string;
  limit?: number;
}

export interface RequestPage {
  items: DriverRequest[];
  nextCursor: string | null;
}

export interface ActionInput {
  action: RequestAction;
  note?: string;
  vehicleId?: string;
  assignee?: string;
  etaMinutes?: number;
}

const enc = encodeURIComponent;

/** `GET /api/requests`: one page, newest first (`requests.manage`: the caller's fleet scope). */
export const listRequests = (q: RequestListQuery = {}, opts?: Opts) =>
  apiFetch<RequestPage>(
    `/api/requests${query({ type: q.type, status: q.status, fleetId: q.fleetId, cursor: q.cursor, limit: q.limit })}`,
    opts,
  );

export const getRequest = (id: string, opts?: Opts) =>
  apiFetch<DriverRequest>(`/api/requests/${enc(id)}`, opts);

/** `POST /api/requests/:id/actions`: the updated request. */
export const requestAction = (id: string, input: ActionInput) =>
  apiFetch<DriverRequest>(`/api/requests/${enc(id)}/actions`, { body: input });

/** Best first, at most 5 (live eligibility). */
export const requestSuggestions = (id: string, opts?: Opts) =>
  apiFetch<ReplacementCandidate[]>(`/api/requests/${enc(id)}/suggestions`, opts);

export const fleetSettings = (fleetId: string, opts?: Opts) =>
  apiFetch<FleetSettings>(`/api/fleets/${enc(fleetId)}/settings`, opts);

/** `null` clears this fleet's own value (inherit from the parent again). */
export const setAutoAssign = (fleetId: string, value: boolean | null) =>
  apiFetch<FleetSettings>(`/api/fleets/${enc(fleetId)}/settings`, {
    method: 'PATCH',
    body: { autoAssignReplacement: value },
  });

/** `GET /api/vehicles/:id/no-gps-insight`; 404 when the vehicle isn't in no-GPS. */
export const noGpsInsight = (vehicleId: string, opts?: Opts) =>
  apiFetch<NoGpsInsight>(`/api/vehicles/${enc(vehicleId)}/no-gps-insight`, opts);
