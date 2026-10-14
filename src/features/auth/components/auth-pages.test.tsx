import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppRouter } from '@/app/router';
import { ApiError } from '@/shared/api/api-client';
import { SessionStore } from '../session/session-store.ts';
import { SessionContext } from '../session/use-session.ts';
import { fakeApi, fakeMe, sessionAs } from '../testing/fake-session.ts';

function renderAt(path: string, session: SessionStore) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }), session);
  render(
    <SessionContext value={session}>
      <RouterProvider router={router} />
    </SessionContext>,
  );
  return router;
}

type Handler = (body: unknown) => Response | Promise<Response>;
const reply = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });
const error = (status: number, code: string, message: string, details?: unknown) =>
  reply(status, { error: { code, message, details } });

/** Stubs `fetch` by `METHOD path` (search ignored); unknown routes are 404. */
function stubApi(routes: Record<string, Handler>) {
  const calls: { key: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${url.split('?')[0]}`;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ key, body });
      return routes[key] ? routes[key](body) : error(404, 'not_found', 'nope');
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

const field = (name: string | RegExp) => screen.getByLabelText(name, { selector: 'input' });

describe('F02-T4: login', () => {
  it('validates, links errors and focuses the first invalid field', async () => {
    const api = fakeApi();
    renderAt('/login', await sessionAs('anonymous', api));
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Sign in' });
    await user.clear(field('Email'));
    await user.type(field('Email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(field('Email')).toHaveAccessibleDescription('Enter a valid email address');
    expect(field('Email')).toHaveFocus();
    expect(field('Password')).toHaveAccessibleDescription('Enter your password');
    expect(api.login).not.toHaveBeenCalled();
    expect(field('Email')).toHaveAttribute('autocomplete', 'username');
    expect(field('Password')).toHaveAttribute('autocomplete', 'current-password');
  });

  it('show/hide toggles the password', async () => {
    renderAt('/login', await sessionAs('anonymous'));
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(field('Password')).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(field('Password')).toHaveAttribute('type', 'text');
  });

  it('disables the button while signing in, then goes to the safe redirect', async () => {
    let finish!: () => void;
    const api = fakeApi({
      login: vi.fn(
        () => new Promise<ReturnType<typeof fakeMe>>((r) => (finish = () => r(fakeMe()))),
      ),
    });
    const router = renderAt('/login?redirect=%2Fadmin%2Fusers', await sessionAs('anonymous', api));
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Sign in' });
    await user.clear(field('Email'));
    await user.type(field('Email'), 'ops@fms.local');
    await user.type(field('Password'), 'Ops@1234{Enter}');
    const button = screen.getByRole('button', { name: /Signing in/ });
    expect(button).toBeDisabled();
    expect(api.login).toHaveBeenCalledWith('ops@fms.local', 'Ops@1234');
    await act(async () => finish());
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/admin/users'));
  });

  it('an unsafe redirect falls back to /live-tracking', async () => {
    const router = renderAt('/login?redirect=%2F%2Fevil.com', await sessionAs('anonymous'));
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Sign in' });
    await user.type(field('Password'), 'x{Enter}');
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/live-tracking'));
  });

  it('401 → generic error; network → "couldn\'t reach"', async () => {
    const api = fakeApi();
    vi.mocked(api.login)
      .mockRejectedValueOnce(new ApiError(401, 'invalid_credentials', 'Invalid email or password'))
      .mockRejectedValueOnce(new ApiError(0, 'network', 'down'));
    renderAt('/login', await sessionAs('anonymous', api));
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Sign in' });
    await user.type(field('Password'), 'wrong{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't reach the server. Try again.",
    );
  });
});

describe('F02-T4: forgot password', () => {
  const CONFIRM = (email: string) =>
    `If an account exists for ${email}, we've sent a link to reset the password. The link is valid for 30 minutes.`;

  it.each([
    ['a known email (202)', 'ops@fms.local', () => reply(202)],
    ['an unknown email (202)', 'nobody@fms.local', () => reply(202)],
    ['a 4xx', 'odd@fms.local', () => error(422, 'validation_failed', 'Invalid')],
  ])('shows the same confirmation for %s', async (_, email, handler) => {
    stubApi({ 'POST /api/auth/forgot-password': handler });
    renderAt('/forgot-password', await sessionAs('anonymous'));
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), `${email}{Enter}`);
    expect(await screen.findByRole('status')).toHaveTextContent(CONFIRM(email));
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toBeInTheDocument();
  });

  it('only a 5xx/network error shows an error', async () => {
    stubApi({ 'POST /api/auth/forgot-password': () => reply(503) });
    renderAt('/forgot-password', await sessionAs('anonymous'));
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), 'ops@fms.local{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't reach the server");
  });
});

describe('F02-T4: reset password', () => {
  it('rules checklist turns to checks as each rule is met; mismatch after blur', async () => {
    renderAt('/reset-password?token=t1', await sessionAs('anonymous'));
    const user = userEvent.setup();
    const rules = await screen.findByRole('list', { name: 'Password rules' });
    const met = () =>
      within(rules)
        .getAllByRole('listitem')
        .map((li) => `${li.textContent?.replace(/ \((not )?met\)/, '')}:${li.dataset.met}`);
    expect(met()).toEqual(['8+ characters:false', 'A letter:false', 'A number:false']);
    await user.type(field('New password'), 'abc');
    expect(met()).toEqual(['8+ characters:false', 'A letter:true', 'A number:false']);
    await user.type(field('New password'), 'defgh1');
    expect(met()).toEqual(['8+ characters:true', 'A letter:true', 'A number:true']);
    await user.type(field('Confirm password'), 'abcdefgh2');
    expect(screen.queryByText("Passwords don't match")).not.toBeInTheDocument();
    await user.tab();
    expect(field('Confirm password')).toHaveAccessibleDescription("Passwords don't match");
  });

  it('success → /login with the "password updated" notice', async () => {
    const calls = stubApi({ 'POST /api/auth/reset-password': () => reply(204) });
    const router = renderAt('/reset-password?token=t1', await sessionAs('anonymous'));
    const user = userEvent.setup();
    await user.type(
      await screen.findByLabelText('New password', { selector: 'input' }),
      'abcd1234',
    );
    await user.type(field('Confirm password'), 'abcd1234{Enter}');
    expect(
      await screen.findByText('Password updated. Sign in with your new password.'),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(calls.at(-1)).toEqual({
      key: 'POST /api/auth/reset-password',
      body: { token: 't1', password: 'abcd1234' },
    });
  });

  it.each([
    ['missing token', '/reset-password', null],
    ['410', '/reset-password?token=used', () => error(410, 'gone', 'gone')],
  ])('%s → expired state with "Request a new link"', async (_, path, handler) => {
    if (handler) stubApi({ 'POST /api/auth/reset-password': handler });
    renderAt(path, await sessionAs('anonymous'));
    const user = userEvent.setup();
    if (handler) {
      await user.type(
        await screen.findByLabelText('New password', { selector: 'input' }),
        'abcd1234',
      );
      await user.type(field('Confirm password'), 'abcd1234{Enter}');
    }
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This reset link has expired or was already used.',
    );
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('a 422 shows the server field message', async () => {
    stubApi({
      'POST /api/auth/reset-password': () =>
        error(422, 'validation_failed', 'Bad', [
          { path: ['password'], message: 'Password must contain a number' },
        ]),
    });
    renderAt('/reset-password?token=t1', await sessionAs('anonymous'));
    const user = userEvent.setup();
    await user.type(
      await screen.findByLabelText('New password', { selector: 'input' }),
      'abcd1234',
    );
    await user.type(field('Confirm password'), 'abcd1234{Enter}');
    await vi.waitFor(() =>
      expect(field('New password')).toHaveAccessibleDescription(
        expect.stringContaining('Password must contain a number'),
      ),
    );
  });
});

describe('F02-T4: accept invite', () => {
  const invite = { email: 'new@fms.local', expiresAt: Date.UTC(2026, 9, 21, 9, 0) };

  it('shows the invited email read-only, the rules, and lands signed in', async () => {
    stubApi({ 'GET /api/auth/invites/tok': () => reply(200, invite) });
    const api = fakeApi();
    const session = await sessionAs('anonymous', api);
    const router = renderAt('/accept-invite?token=tok', session);
    const user = userEvent.setup();
    const email = await screen.findByLabelText('Email');
    expect(email).toHaveValue('new@fms.local');
    expect(email).toHaveAttribute('readonly');
    expect(screen.getByRole('list', { name: 'Password rules' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(field('Name')).toHaveFocus();
    expect(field('Name')).toHaveAccessibleDescription('Enter your name');
    await user.type(field('Name'), 'New User');
    await user.type(field('New password'), 'abcd1234');
    await user.type(field('Confirm password'), 'abcd1234{Enter}');
    expect(api.acceptInvite).toHaveBeenCalledWith('tok', 'New User', 'abcd1234');
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/live-tracking'));
    expect(session.getSnapshot().me?.user.id).toBe('u-new');
  });

  it.each([
    ['missing token', '/accept-invite', null],
    ['410', '/accept-invite?token=old', () => error(410, 'gone', 'gone')],
    ['404', '/accept-invite?token=old', () => error(404, 'not_found', 'nope')],
  ])('%s → "expired or no longer valid"', async (_, path, handler) => {
    if (handler) stubApi({ 'GET /api/auth/invites/old': handler });
    renderAt(path, await sessionAs('anonymous'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This invite has expired or is no longer valid. Ask your administrator for a new invite.',
    );
  });

  it('409 on accept → "already accepted" with a Sign in link', async () => {
    stubApi({ 'GET /api/auth/invites/tok': () => reply(200, invite) });
    const api = fakeApi();
    vi.mocked(api.acceptInvite).mockRejectedValueOnce(new ApiError(409, 'conflict', 'exists'));
    renderAt('/accept-invite?token=tok', await sessionAs('anonymous', api));
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Name', { selector: 'input' }), 'X');
    await user.type(field('New password'), 'abcd1234');
    await user.type(field('Confirm password'), 'abcd1234{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('This invite was already accepted.');
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });
});

describe('F02-T4: user menu', () => {
  it('shows initials, name, email and role; sign out goes to /login', async () => {
    const api = fakeApi({ me: vi.fn(async () => fakeMe()) });
    const session = new SessionStore(api);
    await session.load();
    const router = renderAt('/admin', session);
    const user = userEvent.setup();
    const trigger = await screen.findByRole('button', { name: 'Account: Super Admin' });
    expect(trigger).toHaveTextContent('SA');
    await user.click(trigger);
    const menu = await screen.findByRole('dialog', { name: 'Account' });
    expect(menu).toHaveTextContent('Super Admin');
    expect(menu).toHaveTextContent('u-1@fms.local');
    await user.click(within(menu).getByRole('button', { name: 'Sign out' }));
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(api.logout).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().status).toBe('anonymous');
    expect(screen.queryByText('Your session has expired. Please sign in again.')).toBeNull();
  });
});
