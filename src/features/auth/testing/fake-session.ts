import { PERMISSIONS, type Me, type Permission } from '@shared/contract/index.ts';
import { vi } from 'vitest';
import { ApiError } from '@/shared/api/api-client';
import { SessionStore, type SessionApi } from '../session/session-store.ts';

/**
 * Test helpers: a `Me` (a super admin with every permission unless `permissions` is given), a
 * fake session API (signed out by default) and a store over it.
 */
export const fakeMe = (
  id = 'u-1',
  name = 'Super Admin',
  permissions: Permission[] = [...PERMISSIONS],
): Me => ({
  user: { id, email: `${id}@fms.local`, name, roleId: 'r', fleetIds: ['f1'], status: 'active' },
  role: { id: 'r', name: 'Super Admin', permissions, system: true },
  permissions,
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

/** A store already loaded as `status` (no network), signed in as `me`. */
export async function sessionAs(
  status: 'authenticated' | 'anonymous',
  api = fakeApi(),
  me: Me = fakeMe(),
) {
  if (status === 'authenticated') vi.mocked(api.me).mockResolvedValue(me);
  const store = new SessionStore(api);
  await store.load();
  return store;
}
