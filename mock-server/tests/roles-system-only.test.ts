// @vitest-environment node
import {
  clockSchema,
  inviteSchema,
  roleSchema,
  SYSTEM_ONLY_PERMISSIONS,
} from '@shared/contract/index.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INVITE_TTL_MS } from '../store/accounts.ts';
import { SEED_USERS, startServer } from '../testing/harness.ts';

let server: Awaited<ReturnType<typeof startServer>>;
let cookie: string;
beforeAll(async () => {
  server = await startServer();
  cookie = await server.login(SEED_USERS.superadmin);
});
afterAll(() => server.close());

type Issue = { path: (string | number)[]; message: string };
type ErrorBody = { error: { code: string; message: string; details?: Issue[] } };
const issues = (body: unknown) => (body as ErrorBody).error.details ?? [];

describe('F03-T8: custom roles cannot hold users.invite / roles.manage (F03-R14)', () => {
  it.each(SYSTEM_ONLY_PERMISSIONS)('POST /api/roles with %s → 422 + field message', async (p) => {
    const res = await server.api('POST', '/api/roles', {
      cookie,
      body: { name: `Bad ${p}`, permissions: ['live.view', p] },
    });
    expect(res.status).toBe(422);
    expect((res.body as ErrorBody).error.code).toBe('validation_failed');
    const [issue] = issues(res.body);
    expect(issue?.path).toEqual(['permissions']);
    expect(issue?.message).toContain(p);
  });

  it('PATCH a custom role with either permission → 422 and the role is unchanged', async () => {
    const { api } = server;
    const role = await api('POST', '/api/roles', {
      cookie,
      body: { name: 'Dispatcher', permissions: ['live.view'] },
      schema: roleSchema,
    });
    expect(role.status).toBe(201);
    for (const p of SYSTEM_ONLY_PERMISSIONS) {
      const res = await api('PATCH', `/api/roles/${role.body.id}`, {
        cookie,
        body: { permissions: ['live.view', p] },
      });
      expect(res.status).toBe(422);
      expect(issues(res.body)[0]?.path).toEqual(['permissions']);
    }
    const ok = await api('PATCH', `/api/roles/${role.body.id}`, {
      cookie,
      body: { name: 'Dispatcher 2' },
      schema: roleSchema,
    });
    expect(ok.body.permissions).toEqual(['live.view']);
  });

  it('system roles still answer 409 (not 422) for edits', async () => {
    const res = await server.api('PATCH', '/api/roles/role-super-admin', {
      cookie,
      body: { permissions: ['users.invite'] },
    });
    expect(res.status).toBe(409);
  });

  it('an expired invite can be resent (F03-R9: pending or expired)', async () => {
    const { api } = server;
    const invite = await api('POST', '/api/invites', {
      cookie,
      body: { email: 'late@fms.local', roleId: 'role-viewer', fleetIds: ['f1'] },
      schema: inviteSchema,
    });
    await api('POST', '/api/dev/clock', {
      body: { offsetMs: INVITE_TTL_MS + 60_000 },
      schema: clockSchema,
    });
    try {
      const resent = await api('POST', `/api/invites/${invite.body.id}/resend`, {
        cookie: await server.login(SEED_USERS.superadmin),
        schema: inviteSchema,
      });
      expect(resent.status).toBe(200);
      expect(resent.body.status).toBe('pending');
    } finally {
      await api('POST', '/api/dev/clock', { body: { offsetMs: 0 }, schema: clockSchema });
    }
  });
});
