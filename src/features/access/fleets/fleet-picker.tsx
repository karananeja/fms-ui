import type { Fleet } from '@shared/contract/index.ts';
import { useId, useMemo } from 'react';
import { cn } from '@/shared/lib/utils';

interface FleetPickerBaseProps {
  /** Fleets to choose from: the flat `GET /api/fleets` list (already scoped by the server). */
  fleets: readonly Fleet[];
  /** Hides this fleet and its whole subtree (a fleet can't move under itself, F03-R5). */
  excludeSubtreeOf?: string;
  /**
   * Hides fleets deeper than this (1 = root). For a move target pass
   * `MAX_FLEET_DEPTH - height of the moved subtree`, so the result stays within 5 levels.
   */
  maxDepth?: number;
  disabled?: boolean;
  /** Shown while nothing is selected. */
  placeholder?: string;
  /** Accessible name when there is no visible `<label>` pointing at `id`. */
  'aria-label'?: string;
  /** For `<label htmlFor>`. */
  id?: string;
  className?: string;
}

/**
 * F03-R7: the shared fleet picker. `single` picks one fleet (move targets, F03a);
 * `multi` picks a fleet scope (invites and users, F03b), where a selected fleet implies its
 * subtree, so `value` holds only the chosen fleets, never their descendants.
 */
export type FleetPickerProps = FleetPickerBaseProps &
  (
    | { mode: 'single'; value: string | null; onChange: (fleetId: string | null) => void }
    | { mode: 'multi'; value: readonly string[]; onChange: (fleetIds: string[]) => void }
  );

/** The fleets the picker may offer, in tree order, after `excludeSubtreeOf` and `maxDepth`. */
function pickableFleets(
  fleets: readonly Fleet[],
  { excludeSubtreeOf, maxDepth }: Pick<FleetPickerBaseProps, 'excludeSubtreeOf' | 'maxDepth'>,
): Fleet[] {
  const children = new Map<string | null, Fleet[]>();
  for (const f of fleets) {
    const list = children.get(f.parentId) ?? [];
    list.push(f);
    children.set(f.parentId, list);
  }
  const ids = new Set(fleets.map((f) => f.id));
  // Roots of the visible forest: the scope roots, whose parents aren't in the list.
  const roots = fleets.filter((f) => f.parentId === null || !ids.has(f.parentId));
  const out: Fleet[] = [];
  const walk = (f: Fleet) => {
    if (f.id === excludeSubtreeOf || (maxDepth !== undefined && f.depth > maxDepth)) return;
    out.push(f);
    for (const c of children.get(f.id) ?? []) walk(c);
  };
  roots.forEach(walk);
  return out;
}

/**
 * Placeholder implementation (F03 contract commit): a plain select / checkbox list.
 * F03a replaces it with the searchable tree; the props stay as they are.
 */
export function FleetPicker(props: FleetPickerProps) {
  const { fleets, excludeSubtreeOf, maxDepth, disabled, placeholder, className } = props;
  const autoId = useId();
  const id = props.id ?? autoId;
  const options = useMemo(
    () => pickableFleets(fleets, { excludeSubtreeOf, maxDepth }),
    [fleets, excludeSubtreeOf, maxDepth],
  );
  const indent = (f: Fleet) => '  '.repeat(f.depth - 1);

  if (props.mode === 'single') {
    return (
      <select
        id={id}
        aria-label={props['aria-label']}
        disabled={disabled}
        value={props.value ?? ''}
        onChange={(e) => props.onChange(e.target.value || null)}
        className={cn(
          'h-9 w-full rounded-md border border-tile-border bg-tile px-2 text-sm',
          className,
        )}
      >
        <option value="">{placeholder ?? 'Choose a fleet'}</option>
        {options.map((f) => (
          <option key={f.id} value={f.id}>
            {indent(f) + f.name}
          </option>
        ))}
      </select>
    );
  }

  const selected = new Set(props.value);
  const toggle = (fleetId: string, on: boolean) =>
    props.onChange(on ? [...props.value, fleetId] : props.value.filter((v) => v !== fleetId));
  return (
    <fieldset
      id={id}
      aria-label={props['aria-label']}
      disabled={disabled}
      className={cn(
        'flex max-h-64 flex-col gap-1 overflow-auto rounded-md border border-tile-border bg-tile p-2 text-sm',
        className,
      )}
    >
      {options.length === 0 && <p className="text-text-muted">{placeholder ?? 'No fleets'}</p>}
      {options.map((f) => (
        <label key={f.id} className="flex items-center gap-2">
          <span aria-hidden>{indent(f)}</span>
          <input
            type="checkbox"
            checked={selected.has(f.id)}
            onChange={(e) => toggle(f.id, e.target.checked)}
          />
          {f.name}
        </label>
      ))}
    </fieldset>
  );
}
