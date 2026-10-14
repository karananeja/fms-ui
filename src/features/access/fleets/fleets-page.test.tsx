import type { Fleet } from '@shared/contract/index.ts';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FleetApi } from './fleet-tree-store';
import { FleetsPage } from './fleets-page';

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

// Desktop layout (the vehicles panel sits beside the tree instead of a sheet).
beforeEach(() =>
  vi.stubGlobal(
    'matchMedia',
    vi.fn((media: string) => ({
      matches: true,
      media,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  ),
);
afterEach(() => vi.unstubAllGlobals());

describe('F03-T2 FleetsPage', () => {
  const api = (): FleetApi => ({
    listFleets: vi.fn(async () => FLEETS),
    createFleet: vi.fn(),
    renameFleet: vi.fn(async (id: string, name: string) => ({ ...f(id, 'r', 2), name })),
    moveFleet: vi.fn(),
    deleteFleet: vi.fn(),
    listVehicles: vi.fn(async () => ({ items: [], nextCursor: null })),
    moveVehicles: vi.fn(),
  });

  it('renders the tree; keyboard navigation follows the tree pattern; F2 renames inline', async () => {
    const fake = api();
    render(<FleetsPage api={fake} notify={{ success: vi.fn(), error: vi.fn() }} />);
    const tree = await screen.findByRole('tree', { name: 'Fleet tree' });
    expect(
      within(tree)
        .getAllByRole('treeitem')
        .map((r) => r.getAttribute('aria-label')),
    ).toEqual(['R', 'A', 'A1', 'A2', 'B']);
    tree.focus();
    // Root is selected; ↓ to A, ← collapses A, → expands it, → moves to A1.
    await userEvent.keyboard('{ArrowDown}{ArrowLeft}');
    expect(screen.getByRole('treeitem', { name: 'A' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('treeitem', { name: 'A1' })).toBeNull();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    const a1 = screen.getByRole('treeitem', { name: 'A1' });
    expect(tree).toHaveAttribute('aria-activedescendant', a1.id);
    await userEvent.keyboard('{Enter}');
    expect(a1).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{F2}');
    const input = screen.getByRole('textbox', { name: 'Fleet name' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Alpha one{Enter}');
    expect(fake.renameFleet).toHaveBeenCalledWith('a1', 'Alpha one');
    expect(await screen.findByRole('treeitem', { name: 'Alpha one' })).toBeInTheDocument();
  });

  it('row menu shows why actions are unavailable', async () => {
    render(<FleetsPage api={api()} notify={{ success: vi.fn(), error: vi.fn() }} />);
    await screen.findByRole('tree', { name: 'Fleet tree' });
    await userEvent.click(screen.getByRole('button', { name: 'Actions for B' }));
    const del = await screen.findByRole('menuitem', { name: /Delete/ });
    expect(del).toHaveAttribute('aria-disabled', 'true');
    expect(del).toHaveTextContent('Still has vehicles');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    await userEvent.click(screen.getByRole('button', { name: 'Actions for A1XY' }));
    const add = await screen.findByRole('menuitem', { name: /Add child fleet/ });
    expect(add).toHaveAttribute('aria-disabled', 'true');
    expect(add).toHaveTextContent('at most 5 levels');
  });
});
