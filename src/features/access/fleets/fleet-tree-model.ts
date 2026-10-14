import { MAX_FLEET_DEPTH, type Fleet } from '@shared/contract/index.ts';

/**
 * Pure fleet-tree helpers shared by the store, the tree and the picker (F03-R4, R5, R7).
 * Everything is O(n) over the flat `GET /api/fleets` list, so a few thousand fleets stay cheap.
 */

export interface FleetIndex {
  readonly fleets: readonly Fleet[];
  readonly byId: ReadonlyMap<string, Fleet>;
  /** Children per parent id, in list (creation) order. */
  readonly children: ReadonlyMap<string, readonly Fleet[]>;
  /** Roots of the visible forest: the scope roots (parent missing from the list). */
  readonly roots: readonly Fleet[];
  /** Levels in the subtree, the node included (a leaf is 1). */
  readonly height: ReadonlyMap<string, number>;
  /** Vehicles directly in the fleet: its subtree count minus its children's. */
  readonly direct: ReadonlyMap<string, number>;
}

const NONE: readonly Fleet[] = [];

export function buildFleetIndex(fleets: readonly Fleet[]): FleetIndex {
  const byId = new Map<string, Fleet>();
  for (const f of fleets) byId.set(f.id, f);
  const children = new Map<string, Fleet[]>();
  const roots: Fleet[] = [];
  for (const f of fleets) {
    if (f.parentId === null || !byId.has(f.parentId)) roots.push(f);
    else {
      const list = children.get(f.parentId);
      if (list) list.push(f);
      else children.set(f.parentId, [f]);
    }
  }
  const height = new Map<string, number>();
  const direct = new Map<string, number>();
  // Iterative post-order (no recursion limits for deep or wide trees).
  const order: Fleet[] = [];
  const stack = [...roots];
  while (stack.length) {
    const f = stack.pop()!;
    order.push(f);
    for (const c of children.get(f.id) ?? NONE) stack.push(c);
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const f = order[i]!;
    let h = 0;
    let sum = 0;
    for (const c of children.get(f.id) ?? NONE) {
      h = Math.max(h, height.get(c.id)!);
      sum += c.vehicleCount;
    }
    height.set(f.id, h + 1);
    direct.set(f.id, Math.max(0, f.vehicleCount - sum));
  }
  return { fleets, byId, children, roots, height, direct };
}

export const childrenOf = (index: FleetIndex, id: string): readonly Fleet[] =>
  index.children.get(id) ?? NONE;

/** Ancestors from the parent up to the scope root. */
export function ancestorsOf(index: FleetIndex, id: string): Fleet[] {
  const out: Fleet[] = [];
  let p = index.byId.get(id)?.parentId ?? null;
  while (p !== null) {
    const f = index.byId.get(p);
    if (!f) break;
    out.push(f);
    p = f.parentId;
  }
  return out;
}

/** True when `id` is `ancestorId` or lies below it. */
export function isInSubtree(index: FleetIndex, id: string, ancestorId: string): boolean {
  for (let cur: string | null = id; cur !== null; cur = index.byId.get(cur)?.parentId ?? null) {
    if (cur === ancestorId) return true;
  }
  return false;
}

/** Scope roots (the org root, or a scoped user's top fleet) can't be moved or deleted. */
export const isScopeRoot = (index: FleetIndex, f: Fleet) =>
  f.parentId === null || !index.byId.has(f.parentId);

/** F03-R5: why "Add child fleet" is unavailable, or `null`. */
export function addChildBlocker(f: Fleet): string | null {
  return f.depth >= MAX_FLEET_DEPTH
    ? `Fleets can be nested at most ${MAX_FLEET_DEPTH} levels deep`
    : null;
}

/** F03-R5: why the fleet can't be deleted (only an empty leaf can), or `null`. */
export function deleteBlocker(index: FleetIndex, f: Fleet): string | null {
  if (isScopeRoot(index, f)) return "The root fleet can't be deleted";
  if ((index.direct.get(f.id) ?? 0) > 0) return 'Still has vehicles';
  if (childrenOf(index, f.id).length > 0) return 'Still has child fleets';
  return null;
}

/** F03-R5: why the fleet can't be moved anywhere, or `null`. */
export function moveBlocker(index: FleetIndex, f: Fleet): string | null {
  return isScopeRoot(index, f) ? "The root fleet can't be moved" : null;
}

/** Deepest allowed parent depth when moving `id`, so its subtree stays within 5 levels. */
export const maxParentDepthFor = (index: FleetIndex, id: string) =>
  MAX_FLEET_DEPTH - (index.height.get(id) ?? 1);

export interface VisibleRow {
  fleet: Fleet;
  /** 1-based level in the visible forest (`aria-level`). */
  level: number;
  hasChildren: boolean;
  expanded: boolean;
  /** Matches the search (ancestors shown only for context are `false`). */
  match: boolean;
  posInSet: number;
  setSize: number;
}

export interface VisibleRowsOptions {
  /** Expansion state; ignored while searching (matches and their ancestors are all shown). */
  isExpanded: (id: string) => boolean;
  query?: string;
  /** Hides this fleet and its subtree. */
  excludeSubtreeOf?: string;
  /** Hides fleets deeper than this. */
  maxDepth?: number;
}

/**
 * F03-R4/R7: the rows to render, in tree order. With a query, matching fleets plus their
 * ancestors stay visible (ancestors force-expanded); without one, collapsed subtrees are skipped.
 */
export function visibleRows(index: FleetIndex, opts: VisibleRowsOptions): VisibleRow[] {
  const { excludeSubtreeOf, maxDepth } = opts;
  const q = opts.query?.trim().toLowerCase() ?? '';
  const allowed = (f: Fleet) =>
    f.id !== excludeSubtreeOf && (maxDepth === undefined || f.depth <= maxDepth);

  let keep: Set<string> | null = null;
  const matches = new Set<string>();
  if (q) {
    keep = new Set();
    for (const f of index.fleets) {
      if (!f.name.toLowerCase().includes(q)) continue;
      matches.add(f.id);
      keep.add(f.id);
      for (let p = f.parentId; p !== null && !keep.has(p); p = index.byId.get(p)?.parentId ?? null)
        keep.add(p);
    }
  }

  const out: VisibleRow[] = [];
  // Explicit stack of sibling lists, so deep trees don't recurse.
  type Frame = { list: Fleet[]; i: number; level: number };
  const pick = (list: readonly Fleet[]) =>
    list.filter((f) => allowed(f) && (keep === null || keep.has(f.id)));
  const stack: Frame[] = [{ list: pick(index.roots), i: 0, level: 1 }];
  while (stack.length) {
    const top = stack[stack.length - 1]!;
    if (top.i >= top.list.length) {
      stack.pop();
      continue;
    }
    const f = top.list[top.i++]!;
    const kids = pick(childrenOf(index, f.id));
    const expanded = kids.length > 0 && (keep !== null || opts.isExpanded(f.id));
    out.push({
      fleet: f,
      level: top.level,
      hasChildren: kids.length > 0,
      expanded,
      match: keep === null || matches.has(f.id),
      posInSet: top.i,
      setSize: top.list.length,
    });
    if (expanded) stack.push({ list: kids, i: 0, level: top.level + 1 });
  }
  return out;
}

/** Re-aggregates subtree counts from direct counts after a structural change. */
function withCounts(fleets: Fleet[], direct: ReadonlyMap<string, number>): Fleet[] {
  const index = buildFleetIndex(fleets);
  const total = new Map<string, number>();
  for (const f of fleets) {
    const d = direct.get(f.id) ?? 0;
    total.set(f.id, (total.get(f.id) ?? 0) + d);
    for (const a of ancestorsOf(index, f.id)) total.set(a.id, (total.get(a.id) ?? 0) + d);
  }
  return fleets.map((f) =>
    f.vehicleCount === total.get(f.id) ? f : { ...f, vehicleCount: total.get(f.id) ?? 0 },
  );
}

/** Optimistic move: new parent, subtree depths shifted, subtree counts re-aggregated. */
export function withMove(fleets: readonly Fleet[], id: string, parentId: string): Fleet[] {
  const index = buildFleetIndex(fleets);
  const node = index.byId.get(id);
  const parent = index.byId.get(parentId);
  if (!node || !parent) return [...fleets];
  const shift = parent.depth + 1 - node.depth;
  const moved = fleets.map((f) => {
    if (f.id === id) return { ...f, parentId, depth: f.depth + shift };
    if (shift !== 0 && isInSubtree(index, f.id, id)) return { ...f, depth: f.depth + shift };
    return f;
  });
  return withCounts(moved, index.direct);
}

/** Fleet → the selected ancestor that implies it (shown checked + dimmed, not selectable). */
export function impliedBy(index: FleetIndex, selected: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const id of selected) {
    if (!index.byId.has(id)) continue;
    const stack = [...childrenOf(index, id)];
    while (stack.length) {
      const f = stack.pop()!;
      if (!out.has(f.id)) out.set(f.id, id);
      stack.push(...childrenOf(index, f.id));
    }
  }
  return out;
}
