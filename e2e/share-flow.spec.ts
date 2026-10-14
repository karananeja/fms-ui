import { expect, metres, SIGNED_OUT, test } from './fixtures.ts';
import { movingVehicle, shareMap } from './share-public-helpers.ts';

/**
 * F10-T9 (orchestrator, integration/f10): the intent's "done when" flow across F10a and F10b.
 * Create in the UI → open the copied URL in a fresh signed-out context → live updates →
 * revoke in the UI → the open public page shows "unavailable" without a reload.
 */
test('F10-T9: create in UI → public page live → revoke in UI → unavailable', async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  test.setTimeout(90_000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL! });

  const vehicleId = await movingVehicle(page.request);
  await page.goto(`/live-tracking?vehicle=${vehicleId}`);
  const panel = page.getByRole('region', { name: 'Vehicle details' });
  await expect(panel.getByTestId('details-regno')).not.toBeEmpty({ timeout: 20_000 });
  const regno = (await panel.getByTestId('details-regno').textContent())!.trim();

  // Create with the defaults (24 h, location only, trail off) and copy the URL.
  await panel.getByTestId('share-cta').click();
  const dialog = page.getByRole('dialog', { name: 'Share live location' });
  await dialog.getByRole('button', { name: 'Create link' }).click();
  const urlField = dialog.getByRole('textbox', { name: 'Share link URL' });
  await expect(urlField).toHaveValue(/\/share\/[\w-]+$/);
  await dialog.getByRole('button', { name: 'Copy' }).click();
  await expect(dialog.getByRole('button', { name: 'Copied' })).toBeVisible();
  const copied = await page.evaluate(() =>
    (
      globalThis as unknown as { navigator: { clipboard: { readText(): Promise<string> } } }
    ).navigator.clipboard.readText(),
  );
  expect(copied).toBe(await urlField.inputValue());

  // Fresh signed-out context opens the copied URL.
  const visitor = await browser.newContext({ storageState: SIGNED_OUT, baseURL });
  try {
    const pub = await visitor.newPage();
    await pub.goto(copied);
    await expect(pub.getByTestId('share-regno')).toHaveText(regno);
    await expect(pub.getByTestId('share-marker')).toBeVisible({ timeout: 10_000 });
    await expect(pub.getByTestId('share-live-pill')).toBeVisible();

    // Live updates: the marker moves.
    const start = (await shareMap(pub))!.marker!;
    await expect
      .poll(async () => metres(start, (await shareMap(pub))!.marker!), { timeout: 20_000 })
      .toBeGreaterThan(1);

    // Revoke from the dialog's Links tab.
    await dialog.getByRole('tab', { name: /Links/ }).click();
    const row = dialog.locator('li[data-status="active"]').first();
    await row.getByRole('button', { name: 'Revoke link' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Revoke this link?' });
    await confirm.getByRole('button', { name: 'Revoke' }).click();
    await expect(confirm).toBeHidden();

    // The open public page switches to unavailable on its own (WS 4410), no reload.
    await expect(pub.getByTestId('share-unavailable')).toBeVisible({ timeout: 5_000 });
    await expect(pub.getByTestId('share-unavailable')).toContainText(
      'This link is no longer available',
    );
  } finally {
    await visitor.close();
  }
});
