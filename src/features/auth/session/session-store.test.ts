import type { Me } from '@shared/contract/index.ts';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/api-client';
import { fakeApi, fakeMe, unauthorized } from '../testing/fake-session.ts';
import { SessionStore } from './session-store.ts';

describe('F02-T1: SessionStore', () => {
  it('load: 200 → authenticated with me, once per app start', async () => {
    const api = fakeApi({ me: vi.fn(async () => fakeMe()) });
    const store = new SessionStore(api);
    expect(store.getSnapshot().status).toBe('unknown');
    await Promise.all([store.load(), store.load()]);
    await store.load();
    expect(store.getSnapshot()).toMatchObject({ status: 'authenticated', me: fakeMe() });
    expect(api.me).toHaveBeenCalledTimes(1);
  });

  it('load: 401 → anonymous, without the expiry notice', async () => {
    const store = new SessionStore(fakeApi());
    await store.load();
    expect(store.getSnapshot()).toEqual({ status: 'anonymous', me: null, notice: null });
  });

  it('login → authenticated and clears a notice; a failed login leaves the state', async () => {
    const api = fakeApi();
    const store = new SessionStore(api);
    await store.load();
    store.setNotice('password-updated');
    vi.mocked(api.login).mockRejectedValueOnce(new ApiError(401, 'invalid_credentials', 'x'));
    await expect(store.login('a@b.c', 'bad')).rejects.toBeInstanceOf(ApiError);
    expect(store.getSnapshot()).toMatchObject({ status: 'anonymous', notice: 'password-updated' });
    await store.login('a@b.c', 'good1234');
    expect(store.getSnapshot()).toEqual({ status: 'authenticated', me: fakeMe(), notice: null });
    expect(api.login).toHaveBeenLastCalledWith('a@b.c', 'good1234');
  });

  it('acceptInvite signs the new user in', async () => {
    const store = new SessionStore(fakeApi());
    await store.acceptInvite('tok', 'New User', 'abcd1234');
    expect(store.getSnapshot().me?.user.id).toBe('u-new');
  });

  it('logout clears locally even when the request fails, without an expiry notice', async () => {
    const api = fakeApi({ logout: vi.fn(async () => Promise.reject(unauthorized())) });
    const store = new SessionStore(api);
    await store.login('a@b.c', 'x');
    // A 401 from the logout call itself must not count as an expiry.
    vi.mocked(api.logout).mockImplementationOnce(async () => {
      store.expire();
      throw unauthorized();
    });
    await store.logout();
    expect(store.getSnapshot()).toEqual({ status: 'anonymous', me: null, notice: null });
  });

  it('expire: only an active session expires (with the notice)', async () => {
    const store = new SessionStore(fakeApi());
    store.expire();
    expect(store.getSnapshot().status).toBe('unknown');
    await store.login('a@b.c', 'x');
    store.expire();
    expect(store.getSnapshot()).toEqual({ status: 'anonymous', me: null, notice: 'expired' });
  });

  it('notifies subscribers on every change and stops after unsubscribe', async () => {
    const store = new SessionStore(fakeApi());
    const listener = vi.fn();
    const off = store.subscribe(listener);
    await store.load();
    await store.login('a@b.c', 'x');
    store.expire();
    expect(listener).toHaveBeenCalledTimes(3);
    off();
    await store.login('a@b.c', 'x');
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('a login that finishes before the start-up probe wins', async () => {
    let resolveMe!: (me: Me) => void;
    const api = fakeApi({ me: vi.fn(() => new Promise<Me>((r) => (resolveMe = r))) });
    const store = new SessionStore(api);
    const loading = store.load();
    await store.login('b@c.d', 'x');
    resolveMe(fakeMe('u-other'));
    await loading;
    expect(store.getSnapshot().me?.user.id).toBe('u-1');
  });
});
