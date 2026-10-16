import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

/**
 * F25-T9 + F31-T8: Settings → AI assistant with fake keys. A key is saved without a model; the
 * user enables models per key; the chat model picker (Ask FMS and the dashboard dock) offers only
 * enabled models and follows the choice; disabling the chosen model moves it.
 */

const FAKE_KEY = 'fake-e2e-key-0001-9f3c';

const card = (page: Page, provider: string) =>
  page.getByRole('listitem', { name: `${provider} key` });

async function removeKey(page: Page, provider: string) {
  await page.goto('/settings/ai');
  await page.getByRole('button', { name: `Remove ${provider} key` }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
  await expect(card(page, provider)).toHaveCount(0);
}

test.describe('F25 / F31 user AI keys and enabled models', () => {
  test('F31-T8: save a key, enable two models, pick one in both chats, disable it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/settings/ai');
    await expect(page.getByRole('heading', { name: 'AI assistant' })).toBeVisible();

    // Save: provider + key only (no model field).
    await page.getByRole('button', { name: 'OpenAI' }).click();
    await expect(page.getByLabel('Model', { exact: true })).toHaveCount(0);
    await page.getByLabel('OpenAI API key').fill(FAKE_KEY);
    await page.getByRole('button', { name: 'Save key' }).click();
    const openai = card(page, 'OpenAI');
    await expect(openai).toContainText('fake-…9f3c');
    await expect(openai).toContainText('0 of 2 models enabled');
    await expect(page.getByLabel('OpenAI API key')).toHaveValue('');
    await expect(page.locator('body')).not.toContainText(FAKE_KEY);

    // Enable two models.
    await openai.getByRole('checkbox', { name: 'Enable fake-model-mini' }).check();
    await openai.getByRole('checkbox', { name: 'Enable fake-model', exact: true }).check();
    await expect(openai).toContainText('2 of 2 models enabled');

    try {
      // Ask FMS: the picker lists only the enabled models; pick the second one.
      await page.goto('/admin');
      await page.getByTestId('ask-fms').click();
      const picker = page.getByTestId('assistant-model-picker');
      await expect(picker).toContainText('fake-model-mini');
      await picker.click();
      const menu = page.getByRole('menu');
      await expect(menu.getByRole('menuitemradio', { name: 'fake-model-mini' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await menu.getByRole('menuitemradio', { name: 'fake-model', exact: true }).click();
      await expect(picker).toContainText('OpenAI · fake-model');
      await expect(picker).not.toContainText('fake-model-mini');

      // The dashboard dock shows the same choice (stored per user on the server).
      const res = await page.request.post('/api/dashboards', {
        data: { title: `F31 ${Date.now()}`, widgets: [] },
      });
      expect(res.status()).toBe(201);
      const { id } = (await res.json()) as { id: string };
      try {
        await page.goto(`/dashboards/${id}`);
        const dock = page.getByTestId('chat-dock');
        await expect(dock.getByTestId('assistant-model-picker')).toContainText(
          'OpenAI · fake-model',
        );

        // Disable the chosen model in Settings → the choice moves to the other one.
        await page.goto('/settings/ai');
        await card(page, 'OpenAI')
          .getByRole('checkbox', { name: 'Enable fake-model', exact: true })
          .uncheck();
        await expect(card(page, 'OpenAI')).toContainText('1 of 2 models enabled');
        await page.goto(`/dashboards/${id}`);
        await expect(
          page.getByTestId('chat-dock').getByTestId('assistant-model-picker'),
        ).toContainText('fake-model-mini');
      } finally {
        await page.request.delete(`/api/dashboards/${id}`);
      }
    } finally {
      await removeKey(page, 'OpenAI');
    }
  });

  test('F25-T9: a rejected key is not saved and shows the provider message', async ({ page }) => {
    await page.goto('/settings/ai');
    await page.getByRole('button', { name: 'Anthropic Claude' }).click();
    await page.getByLabel('Anthropic Claude API key').fill('fake-invalid-key-1');
    await page.getByRole('button', { name: 'Save key' }).click();
    await expect(page.getByRole('alert')).toContainText('Anthropic Claude rejected this key.');
    await expect(card(page, 'Anthropic Claude')).toHaveCount(0);
  });
});
