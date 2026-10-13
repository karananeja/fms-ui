// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { FleetTree } from './fleet-tree.ts';

describe('fleet tree', () => {
  it('seeds 1 org → 4 regions → 20 cities → 60 hubs → 120 teams', () => {
    const tree = new FleetTree();
    expect(tree.seededByDepth.slice(1).map((d) => d.length)).toEqual([1, 4, 20, 60, 120]);
  });

  it('enforces max depth on create and move', () => {
    const tree = new FleetTree();
    const team = tree.node(tree.seededByDepth[5]!.at(-1)!);
    expect(() => tree.create(team.id, 'Too deep')).toThrow(/at most 5/);
    const city = tree.node(tree.seededByDepth[3]![0]!);
    const ownHub = tree.node(tree.seededByDepth[4]![0]!);
    expect(() => tree.update(city.id, { parentId: team.id })).toThrow(/at most 5/);
    expect(() => tree.update(city.id, { parentId: ownHub.id })).toThrow(/own subtree/);
    expect(tree.create(tree.node(tree.seededByDepth[4]![0]!).id, 'Team Z').depth).toBe(5);
  });

  it('scope masks cover whole subtrees', () => {
    const tree = new FleetTree();
    const mask = tree.scopeMask(['f1']);
    const inNorth = tree.nodes.filter((n) => n && mask[n.idx]).length;
    expect(inNorth).toBe(1 + 5 + 15 + 30);
  });
});
