import { expect, test } from './fixtures.ts';

/** F25-T9: Settings → AI assistant (add, test, save, chat label, remove) with a fake key. */

const FAKE_KEY = 'fake-e2e-key-0001-9f3c';

test.describe('F25 user AI keys', () => {
  test('F25-T9: add a fake key, test it, save it, see it in the chat header, remove it', async ({
    page,
  }) => {
    await page.goto('/settings/ai');
    await expect(page.getByRole('heading', { name: 'AI assistant' })).toBeVisible();

    await page.getByRole('button', { name: 'OpenAI' }).click();
    await page.getByLabel('OpenAI API key').fill(FAKE_KEY);
    await page.getByRole('button', { name: 'Load models' }).click();
    await page.getByRole('combobox', { name: 'Model' }).selectOption('fake-model-mini');
    await page.getByRole('button', { name: 'Test connection' }).click();
    await expect(page.getByRole('status', { name: 'Test result' })).toContainText('Connected');

    await page.getByRole('button', { name: 'Save key' }).click();
    const row = page.getByRole('listitem', { name: 'OpenAI key' });
    await expect(row).toContainText('fake-…9f3c');
    await expect(row).toContainText('Active');
    await expect(page.getByLabel('OpenAI API key')).toHaveValue('');
    await expect(page.locator('body')).not.toContainText(FAKE_KEY);

    // The chat header names the provider/model answering.
    await page.goto('/admin');
    await page.getByTestId('ask-fms').click();
    await expect(page.getByTestId('assistant-model-label')).toContainText(
      'OpenAI · fake-model-mini',
    );

    await page.goto('/settings/ai');
    await page.getByRole('button', { name: 'Remove OpenAI key' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText(/No keys yet/)).toBeVisible();
  });

  test('F25-T9: a rejected key shows the provider message', async ({ page }) => {
    await page.goto('/settings/ai');
    await page.getByRole('button', { name: 'Anthropic Claude' }).click();
    await page.getByLabel('Anthropic Claude API key').fill('fake-invalid-key-1');
    await page.getByLabel('Model').fill('claude-opus-5-5');
    await page.getByRole('button', { name: 'Test connection' }).click();
    await expect(page.getByRole('status', { name: 'Test result' })).toContainText(
      'Anthropic Claude rejected this key.',
    );
  });
});
