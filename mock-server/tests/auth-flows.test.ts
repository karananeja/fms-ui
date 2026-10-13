// @vitest-environment node
import {
  clockSchema,
  inviteInfoSchema,
  inviteListSchema,
  inviteSchema,
  mailboxSchema,
  meSchema,
} from '@shared/contract/index.ts';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SEED_USERS, startServer } from '../testing/harness.ts';

let server: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => {
  server = await startServer();
});
afterEach(async () => {
  await server.api('POST', '/api/dev/clock', { body: { offsetMs: 0 }, schema: clockSchema });
});
afterAll(() => server.close());

const lastMail = async (to: string) => {
  const box = (
    await server.api('GET', `/api/dev/mailbox?to=${encodeURIComponent(to)}`, {
      schema: mailboxSchema,
    })
  ).body;
  return box.at(-1)!;
};
const shiftClock = (offsetMs: number) =>
  server.api('POST', '/api/dev/clock', { body: { offsetMs }, schema: clockSchema });

describe('F01-T6: auth flows', () => {
  it('login → me → logout → me is 401; bad password is 401 invalid_credentials', async () => {
    const { api } = server;
    const login = await api('POST', '/api/auth/login', { body: SEED_USERS.ops, schema: meSchema });
    expect(login.status).toBe(200);
    expect(login.body.permissions).toContain('share.revoke');
    const cookie = login.cookie!;
    const me = await api('GET', '/api/auth/me', { cookie, schema: meSchema });
    expect(me.body.user.email).toBe('ops@fms.local');
    expect((await api('POST', '/api/auth/logout', { cookie })).status).toBe(204);
    expect((await api('GET', '/api/auth/me', { cookie })).status).toBe(401);
    const bad = await api('POST', '/api/auth/login', {
      body: { ...SEED_USERS.ops, password: 'nope1234' },
    });
    expect(bad.status).toBe(401);
    expect((bad.body as { error: { code: string } }).error.code).toBe('invalid_credentials');
  });

  it('forgot → mailbox → reset → login with the new password; token is single use', async () => {
    const { api } = server;
    expect(
      (await api('POST', '/api/auth/forgot-password', { body: { email: 'nobody@fms.local' } }))
        .status,
    ).toBe(202);
    expect(
      (await api('POST', '/api/auth/forgot-password', { body: { email: SEED_USERS.viewer.email } }))
        .status,
    ).toBe(202);
    const mail = await lastMail(SEED_USERS.viewer.email);
    expect(mail.kind).toBe('reset-password');
    expect(mail.url).toContain(mail.token);
    const weak = await api('POST', '/api/auth/reset-password', {
      body: { token: mail.token, password: 'abcdefgh' },
    });
    expect(weak.status).toBe(422);
    const reset = await api('POST', '/api/auth/reset-password', {
      body: { token: mail.token, password: 'NewPass123' },
    });
    expect(reset.status).toBe(204);
    const again = await api('POST', '/api/auth/reset-password', {
      body: { token: mail.token, password: 'NewPass456' },
    });
    expect(again.status).toBe(410);
    expect((await api('POST', '/api/auth/login', { body: SEED_USERS.viewer })).status).toBe(401);
    const login = await api('POST', '/api/auth/login', {
      body: { email: SEED_USERS.viewer.email, password: 'NewPass123' },
      schema: meSchema,
    });
    expect(login.status).toBe(200);
  });

  it('an expired reset token gives 410 (via the dev clock)', async () => {
    const { api } = server;
    await api('POST', '/api/auth/forgot-password', { body: { email: SEED_USERS.ops.email } });
    const mail = await lastMail(SEED_USERS.ops.email);
    await shiftClock(31 * 60_000);
    const res = await api('POST', '/api/auth/reset-password', {
      body: { token: mail.token, password: 'Later1234' },
    });
    expect(res.status).toBe(410);
  });

  it('invite → accept → login; expired invite gives 410', async () => {
    const { api } = server;
    const admin = await server.login(SEED_USERS.superadmin);
    const created = await api('POST', '/api/invites', {
      cookie: admin,
      body: { email: 'new.user@fms.local', roleId: 'role-viewer', fleetIds: ['f3'] },
      schema: inviteSchema,
    });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('pending');
    const mail = await lastMail('new.user@fms.local');
    const info = await api('GET', `/api/auth/invites/${mail.token}`, { schema: inviteInfoSchema });
    expect(info.body.email).toBe('new.user@fms.local');
    const weak = await api('POST', '/api/auth/accept-invite', {
      body: { token: mail.token, name: 'New', password: 'short' },
    });
    expect(weak.status).toBe(422);
    const accepted = await api('POST', '/api/auth/accept-invite', {
      body: { token: mail.token, name: 'New User', password: 'Welcome123' },
      schema: meSchema,
    });
    expect(accepted.status).toBe(200);
    expect(accepted.cookie).toBeDefined();
    expect(accepted.body.fleetIds).toEqual(['f3']);
    const login = await api('POST', '/api/auth/login', {
      body: { email: 'new.user@fms.local', password: 'Welcome123' },
      schema: meSchema,
    });
    expect(login.body.role.id).toBe('role-viewer');
    expect((await api('GET', `/api/auth/invites/${mail.token}`)).status).toBe(410);

    await api('POST', '/api/invites', {
      cookie: admin,
      body: { email: 'late@fms.local', roleId: 'role-viewer', fleetIds: ['f3'] },
      schema: inviteSchema,
    });
    const late = await lastMail('late@fms.local');
    await shiftClock(7 * 24 * 60 * 60_000 + 60_000);
    expect((await api('GET', `/api/auth/invites/${late.token}`)).status).toBe(410);
    const res = await api('POST', '/api/auth/accept-invite', {
      body: { token: late.token, name: 'Late', password: 'Late12345' },
    });
    expect(res.status).toBe(410);
    await shiftClock(0);
    const list = await api('GET', '/api/invites', { cookie: admin, schema: inviteListSchema });
    expect(list.body.find((i) => i.email === 'late@fms.local')!.status).toBe('pending');
  });
});
