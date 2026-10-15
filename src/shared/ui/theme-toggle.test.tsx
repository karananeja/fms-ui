import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockColorScheme } from '@/shared/theme/test-media';
import { THEME_STORAGE_KEY, themeStore } from '@/shared/theme/theme-store';
import { ThemeToggle } from './theme-toggle';

beforeEach(() => {
  mockColorScheme(true);
  act(() => themeStore().set('system'));
});
afterEach(() => vi.unstubAllGlobals());

describe('DS3-T3: theme toggle', () => {
  it('is a labelled radio group with roving focus and arrow keys', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual(['Light', 'Dark', 'System']);
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked();
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, -1, 0]);
    expect(group).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Light' }));
    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked();
    await user.keyboard('{Home}');
    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked();
  });

  it('the phone button cycles Light → Dark → System and announces it', async () => {
    const user = userEvent.setup();
    act(() => themeStore().set('light'));
    render(<ThemeToggle />);
    const cycle = screen.getByTestId('theme-cycle');
    expect(cycle).toHaveAccessibleName('Theme: Light. Switch to Dark');
    await user.click(cycle);
    expect(themeStore().get()).toBe('dark');
    expect(screen.getByRole('status')).toHaveTextContent('Theme: Dark');
    await user.click(cycle);
    expect(themeStore().get()).toBe('system');
    await user.click(cycle);
    expect(themeStore().get()).toBe('light');
    expect(screen.getByRole('status')).toHaveTextContent('Theme: Light');
  });

  it('the menu variant shows text labels', () => {
    render(<ThemeToggle variant="menu" />);
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveTextContent('Dark');
    expect(screen.queryByTestId('theme-cycle')).toBeNull();
  });
});
