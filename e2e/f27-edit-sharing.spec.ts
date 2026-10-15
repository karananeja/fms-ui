import type { APIRequestContext, Browser, Page } from '@playwright/test';
import { adminApi, createUser } from './auth-helpers.ts';
import { expect, SIGNED_OUT, test } from './fixtures.ts';
import { shot } from './shots.ts';

/**
 * F27 e2e (fake model): the owner shares with edit → the editor drags a widget and asks the AI
 * for a widget → the owner sees both live; a viewer stays read-only; downgrading the editor to
 * view removes their editing UI live; "Can edit" / "View only" badges.
 */

const PASSWORD = 'Edit1234!x';
const SHOTS = 'docs/features/f27-dashboard-edit-sharing/screenshots';

test.use({ storageState: SIGNED_OUT });

type Person = { email: string; page: Page; api: APIRequestContext; close(): Promise<void> };

/** A brand-new Operator signed in in its own browser context (desktop width, dock open). */
async function person(browser: Browser, baseURL: string, admin: APIRequestContext) {
  const email = await createUser(baseURL, admin, PASSWORD);
  const ctx = await browser.newContext({ storageState: SIGNED_OUT, baseURL });
  await ctx.addInitScript(() => localStorage.setItem('fms.dashboards.chat', 'open'));
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  const res = await page.request.post('/api/auth/login', { data: { email, password: PASSWORD } });
  expect(res.ok()).toBe(true);
  return { email, page, api: page.request, close: () => ctx.close() } satisfies Person;
}

async function userId(owner: Person, email: string): Promise<string> {
  const res = await owner.api.get(`/api/dashboards/share-candidates?q=${encodeURIComponent(email)}`);
  const list = (await res.json()) as { userId: string; email: string }[];
  return list.find((c) => c.email === email)!.userId;
}

async function setup(browser: Browser, baseURL: string) {
  const admin = await adminApi(baseURL);
  const [owner, editor, viewer] = [
    await person(browser, baseURL, admin),
    await person(browser, baseURL, admin),
    await person(browser, baseURL, admin),
  ];
  await admin.dispose();
  const res = await owner.api.post('/api/dashboards', {
    data: {
      title: 'Team board',
      widgets: [
        { type: 'text', title: 'Alpha', body: 'Note **Alpha**' },
        { type: 'text', title: 'Beta', body: 'Note **Beta**' },
      ],
    },
  });
  const d = (await res.json()) as { id: string };
  const share = (ids: string[], access: 'view' | 'edit') =>
    owner.api.post(`/api/dashboards/${d.id}/shares`, { data: { userIds: ids, access } });
  expect((await share([await userId(owner, editor.email)], 'edit')).ok()).toBe(true);
  expect((await share([await userId(owner, viewer.email)], 'view')).ok()).toBe(true);
  const close = async () => {
    await owner.api.delete(`/api/dashboards/${d.id}`);
    for (const p of [owner, editor, viewer]) await p.close();
  };
  return { owner, editor, viewer, id: d.id, close };
}

const items = (page: Page) => page.locator('.react-grid-item');

test('F27-T8/T10: editor drags a widget, owner sees it live; badges in Shared with me', async ({
  browser,
  baseURL,
}) => {
  const s = await setup(browser, baseURL!);
  try {
    const { owner, editor } = s;
    await owner.page.goto(`/dashboards/${s.id}`);
    await expect(items(owner.page)).toHaveCount(2);

    // Shared with me: the editor sees "Can edit", the viewer "View only".
    await editor.page.goto('/dashboards?tab=shared');
    const card = editor.page.getByTestId('dashboard-card').filter({ hasText: 'Team board' });
    await expect(card.getByTestId('card-access')).toHaveText('Can edit');
    await s.viewer.page.goto('/dashboards?tab=shared');
    await expect(
      s.viewer.page
        .getByTestId('dashboard-card')
        .filter({ hasText: 'Team board' })
        .getByTestId('card-access'),
    ).toHaveText('View only');

    await editor.page.goto(`/dashboards/${s.id}`);
    await expect(editor.page.getByTestId('can-edit-badge')).toBeVisible();
    await expect(editor.page.getByTestId('action-share')).toHaveCount(0);
    await expect(editor.page.getByTestId('action-delete')).toHaveCount(0);
    await expect(editor.page.getByTestId('chat-dock')).toBeVisible();
    await expect(editor.page.getByTestId('dashboard-grid')).toHaveAttribute('data-breakpoint', 'lg');

    // Drag Alpha by its title to the right; the debounced save PATCHes as the editor.
    const saved = editor.page.waitForResponse(
      (r) => r.url().endsWith(`/api/dashboards/${s.id}`) && r.request().method() === 'PATCH',
    );
    const title = items(editor.page)
      .filter({ has: editor.page.getByRole('heading', { name: 'Alpha' }) })
      .getByTestId('widget-title');
    const box = (await title.boundingBox())!;
    await editor.page.mouse.move(box.x + 10, box.y + box.height / 2);
    await editor.page.mouse.down();
    await editor.page.mouse.move(box.x + 300, box.y + 260, { steps: 12 });
    await editor.page.mouse.move(box.x + 620, box.y + 260, { steps: 12 });
    await editor.page.mouse.up();
    expect((await saved).status()).toBe(200);

    // The owner's open page picks it up over the WebSocket (no reload).
    await expect(owner.page.getByTestId('save-status')).toContainText('Edited by F02 Test User');
    await owner.page.getByTestId('activity-button').click();
    await expect(owner.page.getByTestId('activity-item').first()).toContainText(
      'Rearranged widgets',
    );
    await shot(owner.page, { path: `${SHOTS}/f27-owner-sees-edit.png` });
    await owner.page.keyboard.press('Escape');
  } finally {
    await s.close();
  }
});

test('F27-T8: the editor asks the AI for a widget in their own chat; the owner sees it live', async ({
  browser,
  baseURL,
}) => {
  const s = await setup(browser, baseURL!);
  try {
    const { owner, editor } = s;
    await owner.page.goto(`/dashboards/${s.id}`);
    await expect(items(owner.page)).toHaveCount(2);
    await editor.page.goto(`/dashboards/${s.id}`);
    const box = editor.page.getByRole('textbox', { name: 'Message the assistant' });
    const turn = editor.page.waitForResponse((r) => r.url().endsWith(`/api/dashboards/${s.id}/chat`));
    await box.fill('add a small KPI of running vehicles');
    await box.press('Enter');
    await (await turn).finished();
    const preview = editor.page.getByTestId('widget-preview').first();
    await expect(preview.getByRole('heading', { name: 'Running vehicles' })).toBeVisible();
    // While nothing was added, the owner's thread stays empty (chats are private).
    const thread = await (await owner.api.get(`/api/dashboards/${s.id}/thread`)).json();
    expect(thread).toEqual({ messages: [] });
    await preview.getByTestId('preview-add').click();
    await expect(preview.getByTestId('preview-added')).toHaveText('Added ✓');
    await expect(items(owner.page)).toHaveCount(3);
    await expect(owner.page.getByRole('heading', { name: 'Running vehicles' })).toBeVisible();
  } finally {
    await s.close();
  }
});

test('F27-T9: a viewer stays read-only; downgrading the editor removes the editing UI live', async ({
  browser,
  baseURL,
}) => {
  const s = await setup(browser, baseURL!);
  try {
    const { owner, editor, viewer } = s;
    await viewer.page.goto(`/dashboards/${s.id}`);
    await expect(items(viewer.page)).toHaveCount(2);
    await expect(viewer.page.getByTestId('view-only-badge')).toBeVisible();
    await expect(viewer.page.getByTestId('chat-dock')).toHaveCount(0);
    await expect(viewer.page.getByTestId('chat-toggle')).toHaveCount(0);
    await expect(viewer.page.getByTestId('action-share')).toHaveCount(0);
    await expect(viewer.page.getByRole('button', { name: 'Team board' })).toHaveCount(0);
    await expect(viewer.page.locator('.react-grid-item.static')).toHaveCount(2);

    await editor.page.goto(`/dashboards/${s.id}`);
    await expect(editor.page.getByTestId('can-edit-badge')).toBeVisible();
    await expect(editor.page.getByTestId('chat-dock')).toBeVisible();

    await owner.page.goto(`/dashboards/${s.id}`);
    await owner.page.getByTestId('action-share').click();
    const dialog = owner.page.getByTestId('share-dialog');
    const row = dialog.getByTestId('share-person').filter({ hasText: editor.email });
    await expect(row.getByTestId('share-person-access')).toHaveValue('edit');
    await shot(owner.page, { path: `${SHOTS}/f27-share-dialog.png` });
    await row.getByTestId('share-person-access').selectOption('view');
    await expect(row.getByTestId('share-person-access')).toHaveValue('view');

    // The editor's open page loses the editing UI without a reload.
    await expect(editor.page.getByTestId('view-only-badge')).toBeVisible();
    await expect(editor.page.getByTestId('chat-dock')).toHaveCount(0);
    await expect(editor.page.locator('.react-grid-item.static')).toHaveCount(2);
    const patch = await editor.api.patch(`/api/dashboards/${s.id}`, {
      data: { version: 1, title: 'nope' },
    });
    expect(patch.status()).toBe(403);
  } finally {
    await s.close();
  }
});
