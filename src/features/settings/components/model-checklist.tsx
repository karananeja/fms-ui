import { MAX_ENABLED_MODELS } from '@shared/contract/index.ts';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { inputClass } from '@/features/auth/components/text-field';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { clearFiltered, enableAll, matchesQuery, orderModels } from '../lib/model-list';

/**
 * F31 (§5): a key's models with search. The order is fixed while the list is on screen (it is
 * recomputed when the search or the model list changes), so a tick never moves the row away
 * from the pointer. All / Clear apply to the current search results only.
 */
export function ModelChecklist({
  name,
  available,
  enabled,
  disabled,
  onChange,
}: {
  /** Provider name, for accessible labels. */
  name: string;
  available: readonly string[];
  enabled: readonly string[];
  disabled?: boolean;
  onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState(() => orderModels(available, enabled));
  const [orderKey, setOrderKey] = useState({ available, query });
  if (orderKey.available !== available || orderKey.query !== query) {
    setOrderKey({ available, query });
    setOrder(orderModels(available, enabled));
  }

  const on = new Set(enabled);
  const filtered = order.filter((m) => matchesQuery(m, query));
  const atCap = enabled.length >= MAX_ENABLED_MODELS;
  const toggle = (model: string, checked: boolean) =>
    onChange(checked ? [...enabled, model] : enabled.filter((m) => m !== model));

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-text-faint"
          />
          <input
            type="search"
            aria-label={`Search ${name} models`}
            placeholder="Search models"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={cn(inputClass, 'h-9 pl-8')}
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || atCap || filtered.every((m) => on.has(m))}
          onClick={() => onChange(enableAll(enabled, filtered))}
        >
          All
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || !filtered.some((m) => on.has(m))}
          onClick={() => onChange(clearFiltered(enabled, filtered))}
        >
          Clear
        </Button>
      </div>
      {atCap && (
        <p className="mt-2 text-xs text-warn">Up to {MAX_ENABLED_MODELS} models</p>
      )}
      {filtered.length === 0 ? (
        <p className="mt-2 text-sm text-text-muted">No models match.</p>
      ) : (
        <ul
          aria-label={`${name} models`}
          className="mt-2 max-h-64 overflow-auto rounded-tile border border-tile-border bg-surface-solid py-1"
        >
          {filtered.map((m) => {
            const checked = on.has(m);
            return (
              <li key={m}>
                <label
                  className={cn(
                    'flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-tile',
                    !checked && atCap && 'cursor-not-allowed opacity-60',
                  )}
                >
                  <input
                    type="checkbox"
                    aria-label={`Enable ${m}`}
                    className="size-4 accent-[var(--accent)]"
                    checked={checked}
                    disabled={disabled || (!checked && atCap)}
                    onChange={(e) => toggle(m, e.target.checked)}
                  />
                  <span className="truncate">{m}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
