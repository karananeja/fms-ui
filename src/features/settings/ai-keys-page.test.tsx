import type { AiKeysState, Permission } from '@shared/contract/index.ts';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionContext } from '@/features/auth/session/use-session';
import { fakeApi, fakeMe, sessionAs } from '@/features/auth/testing/fake-session';
import { ApiError } from '@/shared/api/api-client';
import * as api from './api/ai-keys-api';
import { AiKeysPage } from './ai-keys-page';
import { assistantLabel } from './lib/assistant-label';

vi.mock('./api/ai-keys-api', () => ({
  getAiKeys: vi.fn(),
  listAiModels: vi.fn(),
  testAiKey: vi.fn(),
  saveAiKey: vi.fn(),
  removeAiKey: vi.fn(),
  getAiSettings: vi.fn(),
  updateAiSettings: vi.fn(),
  getAssistantStatus: vi.fn(),
}));

const EMPTY: AiKeysState = {
  keys: [],
  status: {
    source: 'server',
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    fake: false,
    reason: null,
  },
  fallback: { allowed: true, serverConfigured: true },
  storageAvailable: true,
};
const SAVED: AiKeysState = {
  ...EMPTY,
  keys: [
    {
      provider: 'xai',
      model: 'grok-4',
      masked: 'xai-…9f3c',
      active: true,
      readable: true,
      createdAt: 1,
      updatedAt: 2,
    },
  ],
  status: { source: 'user', provider: 'xai', model: 'grok-4', fake: false, reason: null },
};

beforeEach(() => {
  vi.mocked(api.getAiKeys).mockResolvedValue(EMPTY);
  vi.mocked(api.getAiSettings).mockResolvedValue({
    allowServerKeyFallback: true,
    serverConfigured: true,
    serverProvider: 'anthropic',
    serverModel: 'claude-opus-5-5',
  });
});

async function renderPage(permissions: Permission[] = ['chat.use']) {
  const session = await sessionAs('authenticated', fakeApi(), fakeMe('u-1', 'T', permissions));
  render(
    <SessionContext value={session}>
      <AiKeysPage />
    </SessionContext>,
  );
  await screen.findByRole('heading', { name: 'Answering with' });
}

describe('F25-T8: Settings → AI assistant', () => {
  it('labels who answers', () => {
    expect(assistantLabel(SAVED.status)).toBe('xAI Grok · grok-4 · your key');
    // The shared default key is never named in the UI.
    expect(assistantLabel(EMPTY.status)).toBe('Anthropic Claude · claude-opus-5-5');
    expect(
      assistantLabel({
        source: 'none',
        provider: null,
        model: null,
        fake: false,
        reason: 'fallback_disabled',
      }),
    ).toBeNull();
  });

  it('adds a key: load models, test, save; the key input is cleared', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listAiModels).mockResolvedValue({ models: ['grok-4', 'grok-4-fast'] });
    vi.mocked(api.testAiKey).mockResolvedValue({
      ok: true,
      message: 'Connected. grok-4 is available.',
      models: ['grok-4', 'grok-4-fast'],
    });
    vi.mocked(api.saveAiKey).mockResolvedValue(SAVED);
    await renderPage();
    expect(screen.getByRole('status')).toHaveTextContent('Anthropic Claude · claude-opus-5-5');
    expect(screen.getByRole('status')).not.toHaveTextContent(/server key/i);
    expect(screen.queryByRole('heading', { name: 'Organisation' })).toBeNull();

    const key = screen.getByLabelText('xAI Grok API key');
    expect(key).toHaveAttribute('type', 'password');
    await user.type(key, 'xai-secret-9f3c');
    await user.click(screen.getByRole('button', { name: 'Load models' }));
    expect(api.listAiModels).toHaveBeenCalledWith({ provider: 'xai', apiKey: 'xai-secret-9f3c' });
    expect(await screen.findByRole('combobox', { name: 'Model' })).toHaveValue('grok-4');

    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByRole('status', { name: 'Test result' })).toHaveTextContent(
      'Connected.',
    );

    await user.click(screen.getByRole('button', { name: 'Save key' }));
    expect(api.saveAiKey).toHaveBeenCalledWith('xai', {
      apiKey: 'xai-secret-9f3c',
      model: 'grok-4',
    });
    const row = await screen.findByRole('listitem', { name: 'xAI Grok key' });
    expect(row).toHaveTextContent('xai-…9f3c');
    expect(row).toHaveTextContent('Active');
    expect(screen.getByLabelText('xAI Grok API key')).toHaveValue('');
    expect(screen.getByLabelText('xAI Grok API key')).toHaveAttribute(
      'placeholder',
      'Leave empty to keep xai-…9f3c',
    );
    expect(document.body.textContent).not.toContain('xai-secret-9f3c');
  });

  it('shows a failed test and server errors', async () => {
    const user = userEvent.setup();
    vi.mocked(api.testAiKey).mockResolvedValue({
      ok: false,
      message: 'OpenAI rejected this key.',
      models: [],
    });
    vi.mocked(api.listAiModels).mockRejectedValue(
      new ApiError(429, 'rate_limited', 'Too many key checks. Try again in 40 s.'),
    );
    await renderPage();
    await user.click(screen.getByRole('button', { name: 'OpenAI' }));
    await user.type(screen.getByLabelText('OpenAI API key'), 'sk-wrong-key-1');
    await user.type(screen.getByLabelText('Model'), 'gpt-5');
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByRole('status', { name: 'Test result' })).toHaveTextContent(
      'OpenAI rejected this key.',
    );
    await user.click(screen.getByRole('button', { name: 'Load models' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many key checks');
  });

  it('removes a key after confirming', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getAiKeys).mockResolvedValue(SAVED);
    vi.mocked(api.removeAiKey).mockResolvedValue(EMPTY);
    await renderPage();
    await user.click(screen.getByRole('button', { name: 'Remove xAI Grok key' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(api.removeAiKey).toHaveBeenCalledWith('xai');
    expect(await screen.findByText(/No keys yet/)).toBeInTheDocument();
  });

  it('admins get the fallback switch; storage unavailable disables Save', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getAiKeys).mockResolvedValue({ ...EMPTY, storageAvailable: false });
    vi.mocked(api.updateAiSettings).mockResolvedValue({
      allowServerKeyFallback: false,
      serverConfigured: true,
      serverProvider: 'anthropic',
      serverModel: 'claude-opus-5-5',
    });
    await renderPage(['chat.use', 'roles.manage']);
    expect(screen.getByText(/can't store keys/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('xAI Grok API key'), 'xai-secret-9f3c');
    await user.type(screen.getByLabelText('Model'), 'grok-4');
    expect(screen.getByRole('button', { name: 'Save key' })).toBeDisabled();

    const toggle = await screen.findByRole('checkbox', {
      name: 'Let users without their own key use the default assistant',
    });
    expect(toggle).toBeChecked();
    await act(() => user.click(toggle));
    expect(api.updateAiSettings).toHaveBeenCalledWith({ allowServerKeyFallback: false });
    await vi.waitFor(() => expect(toggle).not.toBeChecked());
  });
});
