import { useRef, useState, type KeyboardEvent } from 'react';
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import type { ThemePreference } from '@/shared/theme/theme-store';
import { useTheme } from '@/shared/theme/use-theme';

const OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

const labelOf = (p: ThemePreference) => OPTIONS.find((o) => o.value === p)!.label;

function ThemeRadios({ withText, className }: { withText: boolean; className?: string }) {
  const { preference, setPreference } = useTheme();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent, k: number) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    let next: number | undefined;
    if (step) next = (k + step + OPTIONS.length) % OPTIONS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = OPTIONS.length - 1;
    if (next === undefined) return;
    e.preventDefault();
    setPreference(OPTIONS[next]!.value);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      data-testid="theme-toggle"
      className={cn(
        'items-center gap-0.5 rounded-tile border border-tile-border bg-tile p-0.5',
        className,
      )}
    >
      {OPTIONS.map(({ value, label, icon: Icon }, k) => {
        const checked = preference === value;
        return (
          <button
            key={value}
            ref={(el) => {
              refs.current[k] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={label}
            title={`${label} theme`}
            tabIndex={checked ? 0 : -1}
            onClick={() => setPreference(value)}
            onKeyDown={(e) => onKeyDown(e, k)}
            className={cn(
              'flex h-7 items-center justify-center gap-1.5 rounded-[10px] text-xs text-text-muted outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-ring',
              withText ? 'flex-1 px-2' : 'w-7',
              checked && 'bg-accent-soft text-accent hover:text-accent',
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {withText && label}
          </button>
        );
      })}
    </div>
  );
}

/** Below `sm`: one button cycling Light → Dark → System; the new value is announced. */
function ThemeCycle({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();
  const [announce, setAnnounce] = useState('');
  const k = OPTIONS.findIndex((o) => o.value === preference);
  const { icon: Icon } = OPTIONS[k]!;
  const next = OPTIONS[(k + 1) % OPTIONS.length]!;
  return (
    <>
      <button
        type="button"
        data-testid="theme-cycle"
        aria-label={`Theme: ${labelOf(preference)}. Switch to ${next.label}`}
        title={`Theme: ${labelOf(preference)}`}
        onClick={() => {
          setPreference(next.value);
          setAnnounce(`Theme: ${next.label}`);
        }}
        className={cn(
          'size-9 items-center justify-center rounded-md text-text-muted outline-none hover:bg-tile hover:text-text focus-visible:ring-2 focus-visible:ring-ring',
          className,
        )}
      >
        <Icon className="size-4" aria-hidden />
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {announce}
      </span>
    </>
  );
}

/**
 * DS3-R5: theme switch. `header`: an icon radio group (≥ 640 px) or a cycling icon button
 * (phones). `menu`: the radio group with text, for the user menu.
 */
export function ThemeToggle({ variant = 'header' }: { variant?: 'header' | 'menu' }) {
  if (variant === 'menu') return <ThemeRadios withText className="flex w-full" />;
  return (
    <>
      <ThemeRadios withText={false} className="hidden sm:flex" />
      <ThemeCycle className="flex sm:hidden" />
    </>
  );
}
