import type {
  BreakdownReason,
  DriverMe,
  DriverRequest,
  GeoPoint,
  RequestType,
} from '@shared/contract/index.ts';
import { apiFetch } from '@/shared/api/api-client';

/** F13: the F11 calls the driver page makes (all `driver.self`). Non-2xx throws `ApiError`. */

export interface NewRequest {
  type: RequestType;
  reason?: BreakdownReason;
  note: string;
  location?: GeoPoint;
}

interface Opts {
  signal?: AbortSignal;
}

/** `GET /api/driver/me`: the driver, their vehicle (meta + live) and open requests. */
export const fetchDriverMe = (opts?: Opts) => apiFetch<DriverMe>('/api/driver/me', opts);

/** `GET /api/requests`: the driver's own requests (the server scopes them), newest first. */
export const fetchMyRequests = (opts?: Opts) =>
  apiFetch<{ items: DriverRequest[]; nextCursor: string | null }>('/api/requests?limit=50', opts);

/** `POST /api/requests` (201). 409 = an open request of that type exists / no vehicle. */
export const createRequest = (body: NewRequest) =>
  apiFetch<DriverRequest>('/api/requests', { body });
