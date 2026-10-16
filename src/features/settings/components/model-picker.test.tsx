import type { AssistantStatus } from '@shared/contract/index.ts';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api/ai-keys-api';
import { ModelPicker, useAssistantStatus } from './assistant-status';

vi.mock('../api/ai-keys-api', () => ({
  getAssistantStatus: vi.fn(),
  chooseAssistantModel: vi.fn(),
}));

const STATUS: AssistantStatus = {
  source: 'user',
  provider: 'anthropic',
  model: 'claude-opus-5-5',
  fake: false,
  reason: null,
  options: [
    { provider: 'openai', model: 'gpt-5' },
    { provider: 'anthropic', model: 'claude-opus-5-5' },
    { provider: 'anthropic', model: 'claude-haiku-5' },
  ],
  serverOption: { provider: 'anthropic', model: 'claude-sonnet-5' },
};

function Header({ disabled }: { disabled?: boolean }) {
  const assistant = useAssistantStatus();
  return <ModelPicker assistant={assistant} disabled={disabled} />;
}

function renderPicker(disabled?: boolean) {
  const root = createRootRoute({
    component: () => (
      <>
        <Header disabled={disabled} />
        <Outlet />
      </>
    ),
  });
  const index = createRoute({ getParentRoute: () => root, path: '/', component: () => null });
  const settings = createRoute({
    getParentRoute: () => root,
    path: '/settings/ai',
    component: () => <p>Settings page</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([index, settings]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  vi.mocked(api.getAssistantStatus).mockResolvedValue(STATUS);
});

describe('F31-T7: chat model picker', () => {
  it('lists enabled models by provider, ticks the current one, and chooses', async () => {
    const user = userEvent.setup();
    vi.mocked(api.chooseAssistantModel).mockResolvedValue({
      ...STATUS,
      provider: 'openai',
      model: 'gpt-5',
    });
    renderPicker();
    const button = await screen.findByTestId('assistant-model-picker');
    expect(button).toHaveTextContent('Claude · claude-opus-5-5');

    await user.click(button);
    const menu = await screen.findByRole('menu');
    expect(api.getAssistantStatus).toHaveBeenCalledTimes(2); // mount + menu open
    const groups = within(menu).getAllByRole('group');
    expect(within(menu).getByText('OpenAI')).toBeInTheDocument();
    expect(within(menu).getByText('Anthropic Claude')).toBeInTheDocument();
    expect(groups.length).toBeGreaterThanOrEqual(2);
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((i) => i.textContent),
    ).toEqual([
      'gpt-5',
      'claude-opus-5-5',
      'claude-haiku-5',
      'Default assistant · claude-sonnet-5',
    ]);
    expect(within(menu).getByRole('menuitemradio', { name: 'claude-opus-5-5' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(within(menu).getByRole('menuitemradio', { name: 'gpt-5' })).toHaveAttribute(
      'aria-checked',
      'false',
    );

    await user.click(within(menu).getByRole('menuitemradio', { name: 'gpt-5' }));
    expect(api.chooseAssistantModel).toHaveBeenCalledWith({ provider: 'openai', model: 'gpt-5' });
    await vi.waitFor(() => expect(button).toHaveTextContent('OpenAI · gpt-5'));
  });

  it('chooses the default assistant', async () => {
    const user = userEvent.setup();
    vi.mocked(api.chooseAssistantModel).mockResolvedValue({
      ...STATUS,
      source: 'server',
      model: 'claude-sonnet-5',
    });
    renderPicker();
    await user.click(await screen.findByTestId('assistant-model-picker'));
    await user.click(
      await screen.findByRole('menuitemradio', { name: 'Default assistant · claude-sonnet-5' }),
    );
    expect(api.chooseAssistantModel).toHaveBeenCalledWith({ source: 'server' });
  });

  it('Manage models goes to Settings', async () => {
    const user = userEvent.setup();
    const router = renderPicker();
    await user.click(await screen.findByTestId('assistant-model-picker'));
    await user.click(await screen.findByRole('menuitem', { name: 'Manage models' }));
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/settings/ai'));
  });

  it('is disabled while a turn streams', async () => {
    renderPicker(true);
    expect(await screen.findByTestId('assistant-model-picker')).toBeDisabled();
  });

  it('renders nothing with no options and no default assistant', async () => {
    vi.mocked(api.getAssistantStatus).mockResolvedValue({
      ...STATUS,
      source: 'none',
      provider: null,
      model: null,
      reason: 'no_models_enabled',
      options: [],
      serverOption: null,
    });
    renderPicker();
    await vi.waitFor(() => expect(api.getAssistantStatus).toHaveBeenCalled());
    await Promise.resolve();
    expect(screen.queryByTestId('assistant-model-picker')).toBeNull();
  });
});
