import { ChevronDown, Search } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@/shared/lib/utils';
import { STATUS_META } from '../config/status-meta';
import { liveTrackingStore, type LiveTrackingStore } from '../store/live-tracking-store';
import type { SearchField, Suggestion } from '../worker/worker-api';

export const SEARCH_DEBOUNCE_MS = 120;

const FIELDS: { id: SearchField; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'vin', label: 'VIN' },
  { id: 'regno', label: 'Reg' },
  { id: 'deviceId', label: 'Device' },
];

/** The matched prefix of `value`, emphasised. */
function Highlight({ value, prefix, on }: { value: string; prefix: string; on: boolean }) {
  const n = on && value.toUpperCase().startsWith(prefix.toUpperCase()) ? prefix.length : 0;
  return (
    <span>
      {n > 0 && <mark className="bg-transparent text-accent">{value.slice(0, n)}</mark>}
      {value.slice(n)}
    </span>
  );
}

function SuggestionRow({ s, prefix }: { s: Suggestion; prefix: string }) {
  const color = s.status ? STATUS_META[s.status].color : 'var(--text-faint)';
  return (
    <>
      <span className="size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-extrabold">
          <Highlight value={s.regno || '—'} prefix={prefix} on={s.matchedField === 'regno'} />
        </span>
        <span className="block truncate text-[11px] text-text-muted">
          <Highlight value={s.vin} prefix={prefix} on={s.matchedField === 'vin'} />
          {' · '}
          <Highlight value={s.deviceId} prefix={prefix} on={s.matchedField === 'deviceId'} />
        </span>
      </span>
    </>
  );
}

/**
 * F08-R8: vehicle search (combobox). Typing shows suggestions; choosing one locates the vehicle,
 * Enter without a highlighted suggestion applies the prefix as a filter.
 */
export function SearchBox({ store = liveTrackingStore }: { store?: LiveTrackingStore }) {
  const [text, setText] = useState('');
  const [field, setField] = useState<SearchField>('all');
  const [items, setItems] = useState<Suggestion[]>([]);
  /** The prefix + field `items` answer (the reply may lag the text). */
  const [answered, setAnswered] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const listId = useId();

  // Debounced suggestions; stale replies are dropped.
  useEffect(() => {
    const prefix = text.trim();
    const n = ++seq.current;
    // An empty box shows no list, so stale items need no clearing here.
    if (!prefix) return;
    const t = setTimeout(() => {
      void store.suggest(prefix, field).then((res) => {
        if (n !== seq.current) return;
        setItems(res);
        setAnswered(`${field}:${prefix}`);
        setActive(-1);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, field, store]);

  // `/` focuses the search from anywhere outside a text field.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (el?.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      input.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const answeredNow = answered === `${field}:${text.trim()}`;
  const showList = open && text.trim().length > 0 && (items.length > 0 || answeredNow);

  const choose = (s: Suggestion) => {
    setOpen(false);
    setText('');
    void store.locateVehicle(s.vehicleId);
  };

  const applyPrefix = () => {
    const prefix = text.trim();
    if (!prefix) return;
    store.patchFilter({ search: { field, prefix } });
    setOpen(false);
    setText('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setOpen(true);
        setActive((a) => (items.length ? (a + 1) % items.length : -1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setOpen(true);
        setActive((a) => (items.length ? (a <= 0 ? items.length - 1 : a - 1) : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (showList && active >= 0 && items[active]) choose(items[active]);
        else applyPrefix();
        break;
      case 'Escape':
        // Handled here so the details panel's Esc (close) doesn't fire as well.
        e.preventDefault();
        if (showList) setOpen(false);
        else if (text) setText('');
        else input.current?.blur();
        break;
    }
  };

  const fieldLabel = FIELDS.find((f) => f.id === field)!.label;

  return (
    <div data-slot="map-search" className="pointer-events-auto relative w-full lg:w-[340px]">
      <div className="flex h-11 items-center gap-2 rounded-[14px] pr-1.5 pl-3.5 text-text-muted shadow-[0_8px_24px_var(--shadow)] glass focus-within:ring-2 focus-within:ring-ring">
        <Search className="size-4 shrink-0" aria-hidden />
        <input
          ref={input}
          role="combobox"
          aria-label="Search vehicles"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          value={text}
          placeholder="VIN · REG NO · DEVICE ID"
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-text uppercase outline-none placeholder:text-text-muted placeholder:normal-case"
        />
        {!text && (
          <kbd className="hidden rounded-md border border-glass-border px-1.5 py-px text-[11px] font-extrabold text-text-faint lg:block">
            /
          </kbd>
        )}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label={`Search field: ${fieldLabel}`}
              className="flex h-8 items-center gap-1 rounded-[10px] px-2 text-[11px] font-black tracking-[0.1em] uppercase outline-none hover:bg-tile hover:text-text focus-visible:ring-2 focus-visible:ring-ring"
            >
              {fieldLabel}
              <ChevronDown className="size-3.5" aria-hidden />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={8}
              className="z-50 min-w-32 rounded-tile border border-glass-border bg-glass-strong p-1 shadow-[0_8px_24px_var(--shadow)]"
            >
              <DropdownMenu.RadioGroup
                value={field}
                onValueChange={(v) => setField(v as SearchField)}
              >
                {FIELDS.map((f) => (
                  <DropdownMenu.RadioItem
                    key={f.id}
                    value={f.id}
                    className="cursor-pointer rounded px-2.5 py-1.5 text-xs font-extrabold tracking-[0.1em] text-text-muted uppercase outline-none data-highlighted:bg-accent-soft data-highlighted:text-accent data-[state=checked]:text-accent"
                  >
                    {f.label}
                  </DropdownMenu.RadioItem>
                ))}
              </DropdownMenu.RadioGroup>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Vehicle suggestions"
          className="absolute inset-x-0 top-[50px] z-30 max-h-80 overflow-auto rounded-tile border border-glass-border bg-glass-strong p-1 shadow-[0_8px_24px_var(--shadow)]"
        >
          {items.map((s, k) => (
            <li
              key={s.vehicleId}
              id={`${listId}-${k}`}
              role="option"
              aria-selected={k === active}
              // mousedown keeps focus in the input (blur would close the list first).
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(s)}
              onMouseEnter={() => setActive(k)}
              className={cn(
                'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2',
                k === active && 'bg-accent-soft',
              )}
            >
              <SuggestionRow s={s} prefix={text.trim()} />
            </li>
          ))}
          {!items.length && (
            <li role="presentation" className="px-2.5 py-2 text-xs text-text-muted">
              No vehicles match. Press Enter to filter by “{text.trim()}”.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
