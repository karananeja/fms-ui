import { request as apiRequest, type APIRequestContext, type Page } from '@playwright/test';
import { expect, SUPER_ADMIN } from './fixtures.ts';

/** Unique address per call (the mock keeps users for its lifetime). */
export const uniqueEmail = (tag: string) =>
  `f02-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@fms.local`;

/** A fresh API context signed in as the super admin (its own session, not the shared one). */
export async function adminApi(baseURL: string): Promise<APIRequestContext> {
  const ctx = await apiRequest.newContext({ baseURL });
  expect((await ctx.post('/api/auth/login', { data: SUPER_ADMIN })).ok()).toBe(true);
  return ctx;
}

/** Latest dev-mailbox link of `kind` sent to `to` (relative URL). */
export async function mailLink(
  api: APIRequestContext,
  to: string,
  kind: 'invite' | 'reset-password',
): Promise<string> {
  const mails = (await (await api.get(`/api/dev/mailbox?to=${encodeURIComponent(to)}`)).json()) as {
    kind: string;
    url: string;
  }[];
  const mail = mails.filter((m) => m.kind === kind).at(-1);
  expect(mail, `${kind} mail for ${to}`).toBeDefined();
  return mail!.url;
}

/** `POST /api/invites` as an Operator on the root fleet; returns the accept link. */
export async function inviteUser(admin: APIRequestContext, email: string): Promise<string> {
  const fleets = (await (await admin.get('/api/fleets')).json()) as {
    id: string;
    parentId: string | null;
  }[];
  const root = fleets.find((f) => f.parentId === null) ?? fleets[0]!;
  const res = await admin.post('/api/invites', {
    data: { email, roleId: 'role-operator', fleetIds: [root.id] },
  });
  expect(res.status()).toBe(201);
  return mailLink(admin, email, 'invite');
}

/** Invites and accepts through the API: a brand-new user the test can change freely. */
export async function createUser(baseURL: string, admin: APIRequestContext, password: string) {
  const email = uniqueEmail('user');
  const token = new URL(await inviteUser(admin, email), baseURL).searchParams.get('token')!;
  // Accepting signs the caller in, so it runs in its own context.
  const ctx = await apiRequest.newContext({ baseURL });
  try {
    const res = await ctx.post('/api/auth/accept-invite', {
      data: { token, name: 'F02 Test User', password },
    });
    expect(res.ok()).toBe(true);
  } finally {
    await ctx.dispose();
  }
  return email;
}

/** Fills and submits the sign-in form. */
export async function signIn(page: Page, email: string, password: string) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}
