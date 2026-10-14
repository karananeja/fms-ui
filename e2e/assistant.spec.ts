import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { adminApi } from './auth-helpers.ts';
import { expect, SIGNED_OUT, test } from './fixtures.ts';

const SHOTS = 'docs/features/f17-chatbot/screenshots';
const VIEWER = { email: 'viewer@fms.local', password: 'View@1234' };
const OPS = { email: 'ops@fms.local', password: 'Ops@1234' };

const sse = (...events: object[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');

/** The `ChatEvent`s of a finished `/api/chat` response. */
const events = (body: string) =>
  body
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => JSON.parse(l.slice(6)) as { type: string; [k: string]: unknown });

async function openAssistant(page: Page, path = '/admin') {
  await page.goto(path);
  await page.getByTestId('ask-fms').click();
  const panel = page.getByTestId('assistant-panel');
  await expect(panel).toBeVisible();
  return panel;
}

/** Asks and waits for the whole SSE answer; returns its events. */
async function ask(page: Page, question: string) {
  const box = page.getByRole('textbox', { name: 'Message the assistant' });
  await box.fill(question);
  const res = page.waitForResponse((r) => r.url().endsWith('/api/chat'));
  await box.press('Enter');
  return events(await (await res).text());
}

const lastAnswer = (page: Page) => page.getByTestId('assistant-message').last();

/** A vehicle of `fleet` (top-level fleet name), via the super admin. */
async function vehicleOf(baseURL: string, fleet: string) {
  const admin = await adminApi(baseURL);
  const fleets = (await (await admin.get('/api/fleets')).json()) as { id: string; name: string }[];
  const id = fleets.find((f) => f.name === fleet)!.id;
  const res = await admin.get(`/api/vehicles?fleetId=${id}&limit=1`);
  const [v] = ((await res.json()) as { items: { vehicleId: string; regno: string }[] }).items;
  await admin.dispose();
  return v!;
}

/** A new driver with a name no seeded driver has (so `get_driver` isn't ambiguous). */
async function uniqueDriver(baseURL: string) {
  const admin = await adminApi(baseURL);
  const fleets = (await (await admin.get('/api/fleets')).json()) as { id: string; name: string }[];
  // The fake model's rule reads "driver <Capitalised Words>": letters only.
  const tag = Array.from({ length: 6 }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26)),
  );
  const name = `Zorawar Q${tag.join('')}`;
  const phone = `+91 9${String(Math.floor(Math.random() * 1e4)).padStart(4, '0')} ${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}`;
  const res = await admin.post('/api/drivers', {
    data: { name, phone, fleetId: fleets.find((f) => f.name === 'North')!.id },
  });
  expect(res.status()).toBe(201);
  await admin.dispose();
  return name;
}

test('F17-T6: vehicle and driver questions answer with links (fake model)', async ({
  page,
  baseURL,
}) => {
  const v = await vehicleOf(baseURL!, 'North');
  const driverName = await uniqueDriver(baseURL!);
  const panel = await openAssistant(page);
  await expect(panel.getByTestId('suggested-prompt').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/panel-empty.png` });

  // Hold the stream so the running tool chip can be captured.
  let release: () => void = () => {};
  const held = new Promise<void>((r) => (release = r));
  await page.route('**/api/chat', async (route) => {
    await held;
    await route.continue();
  });
  const box = page.getByRole('textbox', { name: 'Message the assistant' });
  await box.fill(`Where is ${v.regno}?`);
  await box.press('Enter');
  await expect(lastAnswer(page)).toHaveAttribute('data-status', 'streaming');
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  release();

  const chip = lastAnswer(page).getByTestId('tool-chip');
  await expect(chip).toContainText(`Looking up ${v.regno}`);
  await expect(chip).toHaveAttribute('data-state', 'ok', { timeout: 15_000 });
  await expect(lastAnswer(page)).toHaveAttribute('data-status', 'done');
  const link = page.getByTestId('assistant-message').first().getByTestId('entity-link').first();
  await expect(link).toHaveText(v.regno);
  await expect(link).toHaveAttribute('href', `/live-tracking?vehicle=${v.vehicleId}`);
  await page.screenshot({ path: `${SHOTS}/panel-answer.png` });

  const evs = await ask(page, `Tell me about driver ${driverName}`);
  expect(evs.map((e) => e.type)).toContain('tool_start');
  expect(evs.at(-1)?.type).toBe('done');
  await expect(lastAnswer(page)).toHaveAttribute('data-status', 'done');
  await expect(lastAnswer(page).getByTestId('tool-chip')).toContainText(driverName);
  const driverLink = lastAnswer(page).locator('[data-testid="entity-link"][data-kind="driver"]');
  await expect(driverLink.first()).toHaveText(driverName);
  await expect(driverLink.first()).toHaveAttribute('href', /^\/analytics\?tab=drivers&driver=/);
  await page.screenshot({ path: `${SHOTS}/tool-chips.png` });

  // The map link closes the sheet and opens the vehicle.
  await link.click();
  await expect(page.getByTestId('assistant-panel')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/live-tracking\\?vehicle=${v.vehicleId}`));
  // The conversation survives closing the sheet.
  await page.getByTestId('ask-fms').click();
  await expect(page.getByTestId('user-message')).toHaveCount(2);
});

test('F17-T6: no-GPS report as CSV (rows match) and as PDF', async ({ page }) => {
  await openAssistant(page);
  const csvEvents = await ask(page, 'Export no-GPS vehicles as CSV');
  const csv = csvEvents.find((e) => e.type === 'report')?.report as {
    rows: number;
    filename: string;
    format: string;
  };
  expect(csv.format).toBe('csv');
  const card = lastAnswer(page).getByTestId('report-card');
  await expect(card).toContainText(csv.filename);
  await expect(card.getByTestId('report-rows')).toHaveText(
    `${csv.rows.toLocaleString('en-IN')} ${csv.rows === 1 ? 'row' : 'rows'}`,
  );
  await page.screenshot({ path: `${SHOTS}/report-card.png` });
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    card.getByRole('link', { name: 'Download' }).click(),
  ]);
  expect(file.suggestedFilename()).toBe(csv.filename);
  const lines = readFileSync((await file.path())!, 'utf8')
    .replace(/^\uFEFF/, '')
    .trimEnd()
    .split(/\r?\n/);
  expect(lines.length - 1).toBe(csv.rows);

  // PDF is capped at 5 k rows: script the same report for one small fleet.
  const script = await page.request.post('/api/dev/assistant/script', {
    data: {
      steps: [
        {
          tools: [
            {
              name: 'create_report',
              input: { kind: 'no-gps', format: 'pdf', fleet: 'Delhi Hub 1' },
            },
          ],
        },
        { text: 'Your PDF report is ready.' },
      ],
    },
  });
  expect(script.ok()).toBe(true);
  const pdfEvents = await ask(page, 'Export the same no-GPS vehicles as PDF for Delhi Hub 1');
  const pdf = pdfEvents.find((e) => e.type === 'report')?.report as { filename: string };
  const pdfCard = lastAnswer(page).getByTestId('report-card');
  await expect(pdfCard).toContainText('pdf');
  const [pdfFile] = await Promise.all([
    page.waitForEvent('download'),
    pdfCard.getByRole('link', { name: 'Download' }).click(),
  ]);
  expect(pdfFile.suggestedFilename()).toBe(pdf.filename);
  expect(pdfFile.suggestedFilename()).toMatch(/\.pdf$/);
  expect(
    readFileSync((await pdfFile.path())!)
      .subarray(0, 5)
      .toString(),
  ).toBe('%PDF-');
});

test.describe('F17-T7: permissions and scope', () => {
  test.use({ storageState: SIGNED_OUT });

  test('a Viewer (no chat.use) has no Ask FMS button', async ({ page }) => {
    expect((await page.request.post('/api/auth/login', { data: VIEWER })).ok()).toBe(true);
    await page.goto('/live-tracking');
    await expect(page.getByTestId('notification-bell')).toBeVisible();
    await expect(page.getByTestId('ask-fms')).toHaveCount(0);
    expect(
      (
        await page.request.post('/api/chat', {
          data: { messages: [{ role: 'user', content: 'hi' }] },
        })
      ).status(),
    ).toBe(403);
  });

  test('an Operator in North gets "not found" for a South vehicle', async ({ page, baseURL }) => {
    const south = await vehicleOf(baseURL!, 'South');
    expect((await page.request.post('/api/auth/login', { data: OPS })).ok()).toBe(true);
    await openAssistant(page, '/requests');
    const evs = await ask(page, `Where is ${south.regno}?`);
    expect(evs.find((e) => e.type === 'tool_end')?.ok).toBe(false);
    expect(evs.some((e) => e.type === 'entities')).toBe(false);
    await expect(lastAnswer(page)).toHaveAttribute('data-status', 'done');
    await expect(lastAnswer(page).getByTestId('tool-chip')).toHaveAttribute('data-state', 'failed');
    await expect(lastAnswer(page)).toContainText(/not found/i);
    await expect(lastAnswer(page).getByTestId('entity-link')).toHaveCount(0);
  });
});

test('F17-T8: mobile, full-screen sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAssistant(page);
  await ask(page, 'How is the fleet doing?');
  await expect(lastAnswer(page)).toHaveAttribute('data-status', 'done');
  const box = await page.getByTestId('assistant-panel').boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(389);
  await page.screenshot({ path: `${SHOTS}/mobile.png` });
});

test('F17-T8: not configured state (SSE error from the server)', async ({ page }) => {
  await page.route('**/api/chat', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sse({
        type: 'error',
        code: 'not_configured',
        message: 'The assistant is not configured on this server',
      }),
    }),
  );
  const panel = await openAssistant(page);
  await ask(page, 'Which vehicles have no GPS right now?');
  await expect(panel.getByTestId('assistant-not-configured')).toContainText(
    "Assistant isn't set up yet",
  );
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/not-configured.png` });
});
