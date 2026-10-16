import {
  MAX_ENABLED_MODELS,
  type AiKeysState,
  type AiKeySummary,
  type AssistantStatus,
  type Permission,
} from '@shared/contract/index.ts';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionContext } from '@/features/auth/session/use-session';
import { fakeApi, fakeMe, sessionAs } from '@/features/auth/testing/fake-session';
import { ApiError } from '@/shared/api/api-client';
import * as api from './api/ai-keys-api';
import { AiKeysPage } from './ai-keys-page';
import { assistantLabel, notConfiguredText } from './lib/assistant-label';

vi.mock('./api/ai-keys-api', () => ({
  getAiKeys: vi.fn(),
  saveAiKey: vi.fn(),
  refreshAiModels: vi.fn(),
  setEnabledAiModels: vi.fn(),
  removeAiKey: vi.fn(),
  getAiSettings: vi.fn(),
  updateAiSettings: vi.fn(),
  getAssistantStatus: vi.fn(),
  chooseAssistantModel: vi.fn(),
}));

const SERVER_STATUS: AssistantStatus = {
  source: 'server',
  provider: 'anthropic',
  model: 'claude-opus-5-5',
  fake: false,
  reason: null,
  options: [],
  serverOption: { provider: 'anthropic', model: 'claude-opus-5-5' },
};
const EMPTY: AiKeysState = {
  keys: [],
  status: SERVER_STATUS,
  fallback: { allowed: true, serverConfigured: true },
  storageAvailable: true,
};
const xaiKey = (over: Partial<AiKeySummary> = {}): AiKeySummary => ({
  provider: 'xai',
  masked: 'xai-…9f3c',
  readable: true,
  availableModels: ['grok-4', 'grok-4-fast', 'grok-code'],
  enabledModels: [],
  modelsFetchedAt: 1,
  createdAt: 1,
  updatedAt: 2,
  ...over,
});
const withKey = (k: AiKeySummary, status: AssistantStatus = SERVER_STATUS): AiKeysState => ({
  ...EMPTY,
  keys: [k],
  status,
});
const userStatus = (model: string): AssistantStatus => ({
  ...SERVER_STATUS,
  source: 'user',
  provider: 'xai',
  model,
  options: [{ provider: 'xai', model }],
});

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

const checkboxNames = (card: HTMLElement) =>
  within(card)
    .getAllByRole('checkbox')
    .map((c) => c.getAttribute('aria-label'));

describe('F25-T8 / F31-T6: Settings → AI assistant', () => {
  it('labels who answers', () => {
    expect(assistantLabel(userStatus('grok-4'))).toBe('xAI Grok · grok-4 · your key');
    // The shared default key is never named in the UI.
    expect(assistantLabel(SERVER_STATUS)).toBe('Anthropic Claude · claude-opus-5-5');
    const none: AssistantStatus = {
      ...SERVER_STATUS,
      source: 'none',
      provider: null,
      model: null,
      reason: 'no_models_enabled',
      serverOption: null,
    };
    expect(assistantLabel(none)).toBeNull();
    expect(notConfiguredText(none)).toBe(
      'Not configured: enable a model for one of your keys in Settings.',
    );
  });

  it('adds a key without a model field; the key input is cleared', async () => {
    const user = userEvent.setup();
    let resolve!: (s: AiKeysState) => void;
    vi.mocked(api.saveAiKey).mockReturnValue(new Promise((r) => (resolve = r)));
    await renderPage();
    expect(screen.getByRole('status')).toHaveTextContent('Anthropic Claude · claude-opus-5-5');
    expect(screen.queryByRole('heading', { name: 'Organisation' })).toBeNull();
    expect(screen.queryByLabelText('Model')).toBeNull();

    const key = screen.getByLabelText('xAI Grok API key');
    expect(key).toHaveAttribute('type', 'password');
    await user.type(key, 'xai-secret-9f3c');
    await user.click(screen.getByRole('button', { name: 'Save key' }));
    expect(api.saveAiKey).toHaveBeenCalledWith('xai', { apiKey: 'xai-secret-9f3c' });
    expect(screen.getByRole('button', { name: 'Checking key…' })).toBeDisabled();
    await act(async () => resolve(withKey(xaiKey())));

    const row = await screen.findByRole('listitem', { name: 'xAI Grok key' });
    expect(row).toHaveTextContent('xai-…9f3c');
    expect(row).toHaveTextContent('0 of 3 models enabled');
    expect(screen.getByLabelText('xAI Grok API key')).toHaveValue('');
    expect(document.body.textContent).not.toContain('xai-secret-9f3c');
  });

  it('shows the save notice and server errors', async () => {
    const user = userEvent.setup();
    vi.mocked(api.saveAiKey)
      .mockRejectedValueOnce(new ApiError(422, 'key_rejected', 'OpenAI rejected this key.'))
      .mockResolvedValueOnce({
        ...withKey(xaiKey({ provider: 'openai', availableModels: [] })),
        notice: "Saved, but the models couldn't be loaded. Try Refresh models.",
      });
    await renderPage();
    await user.click(screen.getByRole('button', { name: 'OpenAI' }));
    await user.type(screen.getByLabelText('OpenAI API key'), 'sk-wrong-key-1');
    await user.click(screen.getByRole('button', { name: 'Save key' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('OpenAI rejected this key.');
    await user.type(screen.getByLabelText('OpenAI API key'), 'sk-right-key-1');
    await user.click(screen.getByRole('button', { name: 'Save key' }));
    expect(await screen.findByText(/models couldn't be loaded/)).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'OpenAI key' })).toHaveTextContent(
      'No models loaded. Try Refresh models.',
    );
  });

  it('ticks and unticks models; enabled first; rolls back on error', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getAiKeys).mockResolvedValue(withKey(xaiKey({ enabledModels: ['grok-code'] })));
    vi.mocked(api.setEnabledAiModels).mockImplementation(async (_p, enabled) =>
      withKey(xaiKey({ enabledModels: enabled }), userStatus(enabled[0] ?? 'grok-4')),
    );
    await renderPage();
    const card = screen.getByRole('listitem', { name: 'xAI Grok key' });
    expect(checkboxNames(card)).toEqual(['Enable grok-code', 'Enable grok-4', 'Enable grok-4-fast']);
    expect(card).toHaveTextContent('1 of 3 models enabled');

    await user.click(within(card).getByRole('checkbox', { name: 'Enable grok-4' }));
    expect(api.setEnabledAiModels).toHaveBeenLastCalledWith('xai', ['grok-code', 'grok-4']);
    await vi.waitFor(() => expect(card).toHaveTextContent('2 of 3 models enabled'));
    expect(screen.getByRole('status')).toHaveTextContent('xAI Grok · grok-code · your key');

    await user.click(within(card).getByRole('checkbox', { name: 'Enable grok-code' }));
    expect(api.setEnabledAiModels).toHaveBeenLastCalledWith('xai', ['grok-4']);
    await vi.waitFor(() =>
      expect(within(card).getByRole('checkbox', { name: 'Enable grok-code' })).not.toBeChecked(),
    );

    vi.mocked(api.setEnabledAiModels).mockRejectedValueOnce(
      new ApiError(500, 'internal', 'Something went wrong'),
    );
    const fast = within(card).getByRole('checkbox', { name: 'Enable grok-4-fast' });
    await user.click(fast);
    await vi.waitFor(() => expect(fast).not.toBeChecked());
    expect(card).toHaveTextContent('1 of 3 models enabled');
  });

  it('searches; All / Clear apply to the search results', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getAiKeys).mockResolvedValue(withKey(xaiKey()));
    vi.mocked(api.setEnabledAiModels).mockImplementation(async (_p, enabled) =>
      withKey(xaiKey({ enabledModels: enabled })),
    );
    await renderPage();
    const card = screen.getByRole('listitem', { name: 'xAI Grok key' });
    await user.type(within(card).getByRole('searchbox', { name: 'Search xAI Grok models' }), '4');
    expect(checkboxNames(card)).toEqual(['Enable grok-4', 'Enable grok-4-fast']);
    await user.click(within(card).getByRole('button', { name: 'All' }));
    expect(api.setEnabledAiModels).toHaveBeenLastCalledWith('xai', ['grok-4', 'grok-4-fast']);
    await user.clear(within(card).getByRole('searchbox'));
    await user.type(within(card).getByRole('searchbox'), 'fast');
    await user.click(within(card).getByRole('button', { name: 'Clear' }));
    expect(api.setEnabledAiModels).toHaveBeenLastCalledWith('xai', ['grok-4']);
    await user.clear(within(card).getByRole('searchbox'));
    await user.type(within(card).getByRole('searchbox'), 'nothing');
    expect(within(card).getByText('No models match.')).toBeInTheDocument();
  });

  it(`caps enabled models at ${MAX_ENABLED_MODELS}`, async () => {
    const many = Array.from({ length: 25 }, (_, i) => `m-${String(i).padStart(2, '0')}`);
    vi.mocked(api.getAiKeys).mockResolvedValue(
      withKey(xaiKey({ availableModels: many, enabledModels: many.slice(0, MAX_ENABLED_MODELS) })),
    );
    await renderPage();
    const card = screen.getByRole('listitem', { name: 'xAI Grok key' });
    expect(within(card).getByText('Up to 20 models')).toBeInTheDocument();
    expect(within(card).getByRole('checkbox', { name: 'Enable m-21' })).toBeDisabled();
    expect(within(card).getByRole('checkbox', { name: 'Enable m-00' })).toBeEnabled();
    expect(within(card).getByRole('button', { name: 'All' })).toBeDisabled();
  });

  it('refreshes models, replaces a key, hides the checklist of an unreadable key', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getAiKeys).mockResolvedValue(withKey(xaiKey({ readable: false })));
    vi.mocked(api.saveAiKey).mockResolvedValue(withKey(xaiKey({ masked: 'xai-…1111' })));
    vi.mocked(api.refreshAiModels).mockResolvedValue(
      withKey(xaiKey({ masked: 'xai-…1111', availableModels: ['grok-5'] })),
    );
    await renderPage();
    const card = screen.getByRole('listitem', { name: 'xAI Grok key' });
    expect(card).toHaveTextContent("Can't be read. Paste it again.");
    expect(within(card).queryAllByRole('checkbox')).toHaveLength(0);

    await user.click(within(card).getByRole('button', { name: 'Replace key' }));
    await user.type(within(card).getByLabelText('New xAI Grok API key'), 'xai-new-key-1111');
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    expect(api.saveAiKey).toHaveBeenCalledWith('xai', { apiKey: 'xai-new-key-1111' });
    await vi.waitFor(() => expect(card).toHaveTextContent('xai-…1111'));
    expect(within(card).queryByLabelText('New xAI Grok API key')).toBeNull();

    await user.click(within(card).getByRole('button', { name: 'Refresh models' }));
    expect(api.refreshAiModels).toHaveBeenCalledWith('xai');
    expect(await within(card).findByRole('checkbox', { name: 'Enable grok-5' })).toBeEnabled();
  });

  it('removes a key after confirming', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getAiKeys).mockResolvedValue(withKey(xaiKey()));
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
