import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { shot } from './shots.ts';

/**
 * F23 (fake model, super admin): chat progress row, Interrupted + Retry (stream cut simulated by
 * route interception), build skeletons, the empty-dashboard starter, type-ahead, Ask FMS hidden
 * on the dashboard page, list search / sort / view kept by "← Dashboards".
 */

const SHOTS = 'docs/features/f23-chat-dashboard-ux/screenshots';
const box = (page: Page) => page.getByRole('textbox', { name: 'Message the assistant' });
const lastAnswer = (page: Page) => page.getByTestId('assistant-message').last();
const sse = (...events: object[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
/** A stream that stops after some text: no `done`, no `error`. */
const CUT_BODY = `: ping\n\n${sse({ type: 'text', delta: 'Partial answer' })}`;

type Dash = { id: string; title: string };
async function seed(api: APIRequestContext, title: string, widgets: object[] = []) {
  const res = await api.post('/api/dashboards', { data: { title, widgets } });
  expect(res.status()).toBe(201);
  return (await res.json()) as Dash;
}
const NOTE = (title: string) => ({ type: 'text', title, body: `Note ${title}` });
const tag = () => `f23${Math.random().toString(36).slice(2, 8)}`;

async function openAssistant(page: Page) {
  await page.goto('/admin');
  await page.getByTestId('ask-fms').click();
  await expect(page.getByTestId('assistant-panel')).toBeVisible();
}

test('F23-T5: progress row with step and elapsed time, then the answer', async ({ page }) => {
  await openAssistant(page);
  let release: () => void = () => {};
  const held = new Promise<void>((r) => (release = r));
  await page.route('**/api/chat', async (route) => {
    await held;
    await route.continue();
  });
  await box(page).fill('Which vehicles have no GPS right now?');
  await box(page).press('Enter');
  const progress = page.getByTestId('chat-progress');
  await expect(progress).toBeVisible();
  await expect(page.getByTestId('chat-progress-label')).toHaveText('Thinking…');
  await expect(page.getByTestId('chat-progress-elapsed')).toHaveText(/^[1-9]\d*s$/, {
    timeout: 4000,
  });
  await expect(page.getByTestId('composer')).toHaveAttribute('data-busy', 'true');
  await shot(page, { path: `${SHOTS}/chat-progress.png` });
  release();
  await expect(lastAnswer(page)).toHaveAttribute('data-status', 'done', { timeout: 15_000 });
  await expect(progress).toHaveCount(0);
});

test('F23-T6: a cut stream shows Interrupted with the partial text; Retry completes', async ({
  page,
}) => {
  await openAssistant(page);
  await page.route('**/api/chat', (route) =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body: CUT_BODY }),
  );
  await box(page).fill('Which vehicles have no GPS right now?');
  await box(page).press('Enter');
  await expect(lastAnswer(page)).toHaveAttribute('data-status', 'interrupted');
  await expect(lastAnswer(page)).toContainText('Partial answer');
  await expect(page.getByTestId('assistant-interrupted')).toBeVisible();
  await shot(page, { path: `${SHOTS}/interrupted.png` });
  await page.unroute('**/api/chat');
  await page.getByTestId('assistant-retry').click();
  await expect(lastAnswer(page)).toHaveAttribute('data-status', 'done', { timeout: 15_000 });
  await expect(page.getByTestId('user-message')).toHaveCount(1);
});

test('F23-T7: dashboard chat cut → Interrupted, Retry re-sends and completes', async ({ page }) => {
  const d = await seed(page.request, `Cut ${tag()}`, [NOTE('Alpha')]);
  try {
    await page.goto(`/dashboards/${d.id}`);
    await expect(page.locator('.react-grid-item')).toHaveCount(1);
    const url = `**/api/dashboards/${d.id}/chat`;
    await page.route(url, (route) =>
      route.fulfill({ status: 200, contentType: 'text/event-stream', body: CUT_BODY }),
    );
    await box(page).fill('add a small KPI of running vehicles');
    await box(page).press('Enter');
    await expect(lastAnswer(page)).toHaveAttribute('data-status', 'interrupted');
    await page.unroute(url);
    const res = page.waitForResponse((r) => r.url().endsWith(`/api/dashboards/${d.id}/chat`));
    await page.getByTestId('assistant-retry').click();
    await (await res).finished();
    await expect(lastAnswer(page)).toHaveAttribute('data-status', 'done', { timeout: 15_000 });
  } finally {
    await page.request.delete(`/api/dashboards/${d.id}`);
  }
});

test('F23-T8: empty dashboard starter; a template builds with skeletons; Ask FMS hidden', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const d = await seed(page.request, `Starter ${tag()}`);
  try {
    await page.goto(`/dashboards/${d.id}`);
    const starter = page.getByTestId('dashboard-starter');
    await expect(starter).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What do you want to see?' })).toBeVisible();
    // No dock on a new dashboard: the starter's own box is the only chat box, and it has focus.
    await expect(page.getByTestId('dock-panel')).toHaveAttribute('data-state', 'hidden');
    await expect(page.getByTestId('chat-dock')).toBeHidden();
    await expect(page.getByTestId('chat-toggle')).toHaveCount(0);
    await expect(box(page)).toHaveCount(1);
    await expect(box(page)).toBeFocused();
    await expect(page.getByTestId('starter-template')).toHaveCount(4);
    await expect(page.getByTestId('starter-group')).toHaveCount(4);
    await expect(page.getByTestId('starter-how')).toContainText('Ask FMS to add widgets');
    await expect(page.getByTestId('ask-fms')).toHaveCount(0);
    await shot(page, { path: `${SHOTS}/starter.png` });

    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    const url = `**/api/dashboards/${d.id}/chat`;
    await page.route(url, async (route) => {
      await held;
      await route.continue();
    });
    await page.locator('[data-template="fleet-health"]').click();
    // The dock slides in with the first message and its progress row; the starter is gone.
    await expect(page.getByTestId('dock-panel')).toHaveAttribute('data-state', 'open');
    await expect(page.getByTestId('dashboard-starter')).toHaveCount(0);
    const dock = page.getByTestId('chat-dock');
    await expect(dock.getByTestId('user-message')).toContainText('fleet health dashboard');
    await expect(dock.getByTestId('chat-progress')).toBeVisible();
    await expect(page.getByTestId('dock-announce')).toHaveText('Assistant panel opened');
    await expect(page.getByTestId('building-banner')).toHaveText(/Building your dashboard/);
    await expect(page.getByTestId('building-skeleton').first()).toBeVisible();
    await expect(box(page)).toBeFocused();
    release();
    await expect(lastAnswer(page)).toHaveAttribute('data-status', 'done', { timeout: 20_000 });
    await expect(page.getByTestId('building-banner')).toHaveCount(0);
    await page.unroute(url);
    // A reload opens with the dock (the thread has messages).
    await page.reload();
    await expect(page.getByTestId('dock-panel')).toHaveAttribute('data-state', 'open');
    await expect(page.getByTestId('chat-dock').getByTestId('user-message').first()).toBeVisible();
    await expect(page.getByTestId('dashboard-starter')).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/dashboards/${d.id}`);
  }
});

test('F23-T12: "Create with AI" hand-off slides the dock in with the prompt', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const keep = await seed(page.request, `Keep ${tag()}`, [NOTE('One')]);
  let created = '';
  try {
    await page.goto('/dashboards');
    await page.getByTestId('ai-hero-example').first().click();
    await page.getByTestId('ai-hero-build').click();
    await expect(page).toHaveURL(/\/dashboards\/[^/?]+/);
    created = new URL(page.url()).pathname.split('/').at(-1)!;
    await expect(page.getByTestId('dock-panel')).toHaveAttribute('data-state', 'open');
    await expect(page.getByTestId('chat-dock').getByTestId('user-message')).toContainText(
      'running, idle and stopped',
    );
    await expect(lastAnswer(page)).toHaveAttribute('data-status', 'done', { timeout: 20_000 });
  } finally {
    await page.request.delete(`/api/dashboards/${keep.id}`);
    if (created) await page.request.delete(`/api/dashboards/${created}`);
  }
});

test('F23-T9: type-ahead in the dashboard dock and the global panel', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const d = await seed(page.request, `Typeahead ${tag()}`, [NOTE('Alpha')]);
  try {
    await page.goto(`/dashboards/${d.id}`);
    await box(page).pressSequentially('top idl');
    const list = page.getByRole('listbox', { name: 'Suggestions' });
    await expect(list.getByRole('option').first()).toContainText('idle time');
    await expect(list.locator('mark').first()).toHaveText(/top|idl/i);
    await box(page).press('ArrowDown');
    await expect(list.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
    await box(page).press('Enter');
    await expect(box(page)).toHaveValue('Top 10 vehicles by idle time this week');
    await expect(list).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/dashboards/${d.id}`);
  }

  await openAssistant(page);
  await box(page).pressSequentially('gps');
  const list = page.getByRole('listbox', { name: 'Suggestions' });
  await expect(list.getByRole('option').first()).toBeVisible();
  await shot(page, { path: `${SHOTS}/type-ahead.png` });
  await box(page).press('Escape');
  await expect(list).toHaveCount(0);
  await expect(page.getByTestId('assistant-panel')).toBeVisible();
  await expect(page.getByTestId('ask-fms')).toHaveCount(1);
});

/** Scroll metrics of the page, `main`, the grid area and the dock's message list. */
type Box = { sh: number; ch: number; st: number } | null;
// A string expression: the e2e tsconfig has no DOM lib.
const metrics = (page: Page) =>
  page.evaluate<{ doc: Box; main: Box; grid: Box; dock: Box; composer?: number; vh: number }>(`(() => {
    const m = (el) => (el ? { sh: el.scrollHeight, ch: el.clientHeight, st: el.scrollTop } : null);
    const q = (s) => document.querySelector(s);
    return {
      doc: m(document.scrollingElement),
      main: m(q('main')),
      grid: m(q('[data-testid="dashboard-scroll"]')),
      dock: m(q('[data-testid="chat-dock"] [data-testid="assistant-messages"]')),
      composer: q('[data-testid="chat-dock"] [data-testid="composer"]')?.getBoundingClientRect().bottom,
      vh: window.innerHeight,
    };
  })()`);

test('F23-T11: tall dashboard scrolls to its last widget; the dock list scrolls on its own', async ({
  page,
}) => {
  const widgets = Array.from({ length: 18 }, (_, k) => NOTE(`Note ${k + 1}`));
  const d = await seed(page.request, `Tall ${tag()}`, widgets);
  // A long thread so the dock's list must scroll.
  await page.route(`**/api/dashboards/${d.id}/thread`, (route) =>
    route.fulfill({
      json: {
        messages: Array.from({ length: 40 }, (_, k) => ({
          id: `m${k}`,
          seq: k + 1,
          role: k % 2 ? 'assistant' : 'user',
          text: `Message ${k + 1} `.repeat(6),
          chips: [],
          change: null,
          previews: [],
          createdAt: k + 1,
        })),
      },
    }),
  );
  try {
    for (const [w, h, dock] of [
      [1440, 900, 'open'],
      [1440, 900, 'closed'],
      [1280, 720, 'open'],
      [390, 844, 'open'],
    ] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.addInitScript((v) => localStorage.setItem('fms.dashboards.chat', v), dock);
      await page.goto(`/dashboards/${d.id}`);
      await expect(page.locator('.react-grid-item')).toHaveCount(18);
      const before = await metrics(page);
      // One scroller: the page and `main` don't scroll, the grid area does.
      expect(before.doc!.sh, `${w}x${h} ${dock} page`).toBeLessThanOrEqual(before.vh + 1);
      expect(before.main!.sh, `${w}x${h} ${dock} main`).toBeLessThanOrEqual(before.main!.ch + 1);
      expect(before.grid!.sh, `${w}x${h} ${dock} grid`).toBeGreaterThan(before.grid!.ch);
      const scroller = page.getByTestId('dashboard-scroll');
      await scroller.hover();
      await page.mouse.wheel(0, 20_000);
      await expect(page.getByRole('heading', { name: 'Note 18' })).toBeInViewport();
      if (w >= 1024 && dock === 'open') {
        const m = await metrics(page);
        expect(m.dock!.sh, 'dock list overflows').toBeGreaterThan(m.dock!.ch);
        expect(m.composer!, 'composer pinned in view').toBeLessThanOrEqual(m.vh + 1);
        expect(m.dock!.st, 'dock pinned to the newest').toBeGreaterThan(0);
        await page.getByTestId('assistant-messages').hover();
        await page.mouse.wheel(0, -5000);
        await expect.poll(async () => (await metrics(page)).dock!.st).toBe(0);
        // The grid kept its own position.
        expect((await metrics(page)).grid!.st).toBeGreaterThan(0);
      }
    }
  } finally {
    await page.request.delete(`/api/dashboards/${d.id}`);
  }
});

test('F23-T10: list search, sort, view and tab counts survive "← Dashboards"', async ({
  page,
}) => {
  const t = tag();
  const a = await seed(page.request, `${t} Zulu`, [NOTE('One')]);
  const b = await seed(page.request, `${t} Alpha`, [NOTE('One'), NOTE('Two')]);
  try {
    await page.goto('/dashboards');
    await expect(page.getByTestId('ai-hero')).toBeVisible();
    await page.getByTestId('dashboards-search').fill(t);
    await page.getByTestId('dashboards-sort').selectOption('name');
    await page.getByTestId('view-list').click();
    await expect(page).toHaveURL(/sort=name/);
    await expect(page).toHaveURL(/view=list/);
    await expect(page).toHaveURL(new RegExp(`q=${t}`));
    const titles = page.getByTestId('card-title');
    await expect(titles).toHaveText([`${t} Alpha`, `${t} Zulu`]);
    await expect(page.getByTestId('tab-mine')).toContainText('(2/');
    await expect(page.getByTestId('dashboard-card').first()).toHaveAttribute('data-view', 'list');
    await page.getByTestId('dashboards-sort').selectOption('widgets');
    await expect(titles).toHaveText([`${t} Alpha`, `${t} Zulu`]);
    await page.getByTestId('dashboards-sort').selectOption('name');

    await titles.first().click();
    await expect(page).toHaveURL(new RegExp(`/dashboards/${b.id}`));
    await expect(page.getByTestId('ask-fms')).toHaveCount(0);
    await page.getByTestId('back-to-dashboards').click();
    await expect(page.getByTestId('dashboards-search')).toHaveValue(t);
    await expect(page.getByTestId('dashboards-sort')).toHaveValue('name');
    await expect(page.getByTestId('view-list')).toHaveAttribute('aria-pressed', 'true');
    await expect(titles).toHaveText([`${t} Alpha`, `${t} Zulu`]);
    await expect(page.getByTestId('ask-fms')).toHaveCount(1);
  } finally {
    await page.request.delete(`/api/dashboards/${a.id}`);
    await page.request.delete(`/api/dashboards/${b.id}`);
  }
});
