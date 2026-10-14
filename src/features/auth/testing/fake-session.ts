import type { Me } from '@shared/contract/index.ts';
import { vi } from 'vitest';
import { ApiError } from '@/shared/api/api-client';
import { SessionStore, type SessionApi } from '../session/session-store.ts';

/** Test helpers: a `Me`, a fake session API (signed out by default) and a store over it. */
export const fakeMe = (id = 'u-1', name = 'Super Admin'): Me => ({
  user: { id, email: `${id}@fms.local`, name, roleId: 'r', fleetIds: ['f1'], status: 'active' },
  role: { id: 'r', name: 'Super Admin', permissions: ['live.view'], system: true },
  permissions: ['live.view'],
  fleetIds: ['f1'],
});

export const unauthorized = () => new ApiError(401, 'unauthenticated', 'Sign in required');

export function fakeApi(over: Partial<SessionApi> = {}): SessionApi {
  return {
    me: vi.fn(async () => Promise.reject(unauthorized())),
    login: vi.fn(async () => fakeMe()),
    logout: vi.fn(async () => undefined),
    acceptInvite: vi.fn(async () => fakeMe('u-new', 'New User')),
    ...over,
  };
}

/** A store already loaded as `status` (no network). */
export async function sessionAs(status: 'authenticated' | 'anonymous', api = fakeApi()) {
  if (status === 'authenticated') vi.mocked(api.me).mockResolvedValue(fakeMe());
  const store = new SessionStore(api);
  await store.load();
  return store;
}
