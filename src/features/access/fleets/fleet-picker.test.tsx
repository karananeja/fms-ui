import type { Fleet } from '@shared/contract/index.ts';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FleetPicker } from './fleet-picker';

const f = (id: string, parentId: string | null, depth: number, vehicleCount = 0): Fleet => ({
  id,
  parentId,
  name: id.toUpperCase(),
  depth,
  vehicleCount,
});

const FLEETS: Fleet[] = [
  f('r', null, 1, 10),
  f('a', 'r', 2, 6),
  f('a1', 'a', 3, 4),
  f('a1x', 'a1', 4, 1),
  f('a1xy', 'a1x', 5, 1),
  f('a2', 'a', 3),
  f('b', 'r', 2, 4),
];

function Multi({ initial = [] as string[], onChange = vi.fn() }) {
  const [value, setValue] = useState<string[]>(initial);
  return (
    <FleetPicker
      mode="multi"
      fleets={FLEETS}
      value={value}
      aria-label="Fleet scope"
      onChange={(v) => {
        setValue(v);
        onChange(v);
      }}
    />
  );
}

describe('F03-T2 FleetPicker', () => {
  it('multi: a selected fleet implies its subtree (checked + dimmed + disabled)', async () => {
    const onChange = vi.fn();
    render(<Multi onChange={onChange} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'A' }));
    expect(onChange).toHaveBeenLastCalledWith(['a']);
    for (const name of ['A1', 'A1X', 'A2']) {
      const box = screen.getByRole('checkbox', { name });
      expect(box).toBeChecked();
      expect(box).toBeDisabled();
    }
    expect(screen.getByRole('treeitem', { name: 'A1' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('checkbox', { name: 'B' })).not.toBeChecked();
    expect(screen.getByTestId('fleet-picker-summary')).toHaveTextContent('Selected: A');
  });

  it('multi: choosing an ancestor replaces chosen descendants; value never lists implied ones', async () => {
    const onChange = vi.fn();
    render(<Multi initial={['a1', 'b']} onChange={onChange} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'A' }));
    expect(onChange).toHaveBeenLastCalledWith(['b', 'a']);
    await userEvent.click(screen.getByRole('checkbox', { name: 'A' }));
    expect(onChange).toHaveBeenLastCalledWith(['b']);
  });

  it('search keeps matches and their ancestors', async () => {
    render(<Multi />);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search Fleet scope' }), 'a1x');
    const tree = screen.getByRole('tree', { name: 'Fleet scope' });
    expect(
      within(tree)
        .getAllByRole('treeitem')
        .map((r) => r.getAttribute('aria-label')),
    ).toEqual(['R', 'A', 'A1', 'A1X', 'A1XY']);
  });

  it('single: excludes the own subtree and too-deep parents; keyboard picks', async () => {
    const onChange = vi.fn();
    render(
      <FleetPicker
        mode="single"
        fleets={FLEETS}
        value={null}
        onChange={onChange}
        excludeSubtreeOf="a1"
        maxDepth={2}
        aria-label="New parent"
      />,
    );
    const tree = screen.getByRole('tree', { name: 'New parent' });
    expect(
      within(tree)
        .getAllByRole('treeitem')
        .map((r) => r.getAttribute('aria-label')),
    ).toEqual(['R', 'A', 'B']);
    tree.focus();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('a');
    await userEvent.click(screen.getByRole('treeitem', { name: 'B' }));
    expect(onChange).toHaveBeenLastCalledWith('b');
  });
});
