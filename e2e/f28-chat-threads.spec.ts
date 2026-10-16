import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

/** F28-T6 (fake model): saved Ask FMS conversations survive a reload; history rename / delete. */

const box = (page: Page) => page.getByRole('textbox', { name: 'Message the assistant' });
const lastAnswer = (page: Page) => page.getByTestId('assistant-message').last();

async function ask(page: Page, question: string) {
  await box(page).fill(question);
  await box(page).press('Enter');
  await expect(lastAnswer(page)).toHaveAttribute('data-status', 'done', { timeout: 15_000 });
}

test('F28-T6: new chat → send → reload → still there → history → rename → delete', async ({
  page,
}) => {
  const tag = `zx${Date.now().toString(36)}`;
  await page.goto('/admin');
  await page.getByTestId('ask-fms').click();
  const panel = page.getByTestId('assistant-panel');
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'New chat' }).click();
  await ask(page, `Which vehicles have no GPS right now ${tag}?`);
  await expect(page.getByTestId('assistant-thread-title')).toBeVisible();

  // An older conversation to switch to.
  await panel.getByRole('button', { name: 'New chat' }).click();
  await expect(page.getByTestId('user-message')).toHaveCount(0);
  await ask(page, `Who are the top drivers this week ${tag}?`);

  // Reload: the tab reopens on the same conversation.
  await page.reload();
  await page.getByTestId('ask-fms').click();
  await expect(page.getByTestId('user-message')).toHaveCount(1);
  await expect(page.getByTestId('user-message')).toContainText(`top drivers this week ${tag}`);
  await expect(lastAnswer(page)).toHaveAttribute('data-status', 'done');

  // History: search, open the older one and continue it.
  await page.getByTestId('assistant-history').click();
  const history = page.getByTestId('chat-history');
  await history.getByRole('searchbox', { name: 'Search conversations' }).fill('');
  const rows = history.getByTestId('chat-history-row');
  await expect(rows.first()).toBeVisible();
  const older = rows.filter({ hasText: `no GPS right now ${tag}` });
  await expect(older).toHaveCount(1);
  await expect(rows.filter({ hasText: `top drivers this week ${tag}` })).toHaveAttribute(
    'data-open',
    'true',
  );
  await older.getByRole('button').first().click();
  await expect(page.getByTestId('chat-history')).toHaveCount(0);
  await expect(page.getByTestId('user-message')).toContainText(`no GPS right now ${tag}`);
  await ask(page, `And how many are running ${tag}?`);
  await expect(page.getByTestId('user-message')).toHaveCount(2);

  // Rename inline.
  await page.getByTestId('assistant-history').click();
  const row = page
    .getByTestId('chat-history-row')
    .filter({ hasText: `running ${tag}` })
    .first();
  await row.hover();
  await row.getByTestId('chat-history-menu').click();
  await row.getByRole('button', { name: 'Rename' }).click();
  const title = page.getByRole('textbox', { name: 'Conversation title' });
  await title.fill(`Renamed ${tag}`);
  await title.press('Enter');
  const renamed = page.getByTestId('chat-history-row').filter({ hasText: `Renamed ${tag}` });
  await expect(renamed).toHaveCount(1);

  // Delete the open conversation: inline confirm, then a new chat and a toast.
  await renamed.hover();
  await renamed.getByTestId('chat-history-menu').click();
  await renamed.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText("Delete this conversation? This can't be undone.")).toBeVisible();
  await page.getByTestId('chat-history-confirm-delete').click();
  await expect(page.getByText('Conversation deleted')).toBeVisible();
  await expect(page.getByTestId('chat-history-row').filter({ hasText: `Renamed ${tag}` })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to the conversation' }).click();
  await expect(page.getByTestId('user-message')).toHaveCount(0);
  await expect(page.getByTestId('suggested-prompt').first()).toBeVisible();
});
