import { uniqueEmail } from './auth-helpers.ts';
import { expect, test } from './fixtures.ts';

/** F29-T4 (part): a confirmed assistant action shows on the Activity page, and Undo works. */

test.describe('F29 Activity page', () => {
  test('lists a confirmed action; What changed; Undo reverts it', async ({ page }) => {
    const email = uniqueEmail('f29');
    const fleets = (await (await page.request.get('/api/fleets')).json()) as { id: string }[];
    // What an assistant write tool does: propose (dev-only route), then the user confirms.
    const proposed = await page.request.post('/api/dev/actions/propose', {
      data: {
        kind: 'invite.create',
        params: { email, role: 'Viewer', fleets: [fleets[0]!.id] },
        threadId: 'thr-e2e',
      },
    });
    expect(proposed.status()).toBe(201);
    const card = (await proposed.json()) as { id: string; status: string };
    expect(card.status).toBe('proposed');
    const confirmed = await page.request.post(`/api/actions/${card.id}/confirm`);
    expect(((await confirmed.json()) as { status: string }).status).toBe('done');

    await page.goto('/admin/activity');
    await expect(page.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search activity' }).fill(email);
    const row = page.getByTestId('activity-row').filter({ hasText: `Invite ${email}` });
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute('data-status', 'done');
    await expect(row.getByRole('link', { name: 'Open chat' })).toBeVisible();

    await row.getByRole('button', { name: 'What changed' }).click();
    await expect(row.getByRole('table', { name: 'What changed' })).toContainText(email);

    await row.getByRole('button', { name: 'Undo' }).click();
    await row.getByRole('button', { name: 'Yes, undo' }).click();
    await expect(
      page.getByTestId('activity-row').filter({ hasText: `Undo: Invite ${email}` }),
    ).toHaveAttribute('data-status', 'undo');
    await expect(
      page.getByTestId('activity-row').filter({ hasText: `Invite ${email}` }).first(),
    ).toBeVisible();
    await expect(page.locator('[data-testid="activity-row"][data-status="undone"]')).toHaveCount(1);

    const invites = (await (await page.request.get('/api/invites')).json()) as {
      email: string;
      status: string;
    }[];
    expect(invites.find((i) => i.email === email)?.status).toBe('revoked');
  });
});
