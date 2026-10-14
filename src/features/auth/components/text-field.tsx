import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

export const inputClass =
  'h-11 w-full rounded-tile border border-tile-border bg-surface-solid px-3.5 text-sm text-text outline-none placeholder:text-text-faint focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent/30 aria-invalid:border-danger aria-invalid:focus-visible:ring-danger/25 read-only:text-text-muted';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  error?: string;
  /** Extra content under the input (e.g. the password rules), also linked by `aria-describedby`. */
  hint?: ReactNode;
  hintId?: string;
  /** Rendered inside the input box, right-aligned (e.g. show/hide). */
  adornment?: ReactNode;
}

/** Labelled input with its error linked via `aria-describedby` (F02-R13). */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { id, label, error, hint, hintId, adornment, className, ...input },
  ref,
) {
  const errorId = `${id}-error`;
  const describedBy = [error && errorId, hint && hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('mb-4', className)}>
      <label htmlFor={id} className="mb-1.5 block text-xs font-bold text-text-muted">
        {label}
      </label>
      <div className="relative">
        <input
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(inputClass, adornment && 'pr-11')}
          {...input}
        />
        {adornment && (
          <div className="absolute inset-y-0 right-1 flex items-center">{adornment}</div>
        )}
      </div>
      {error && (
        <p id={errorId} className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      )}
      {hint}
    </div>
  );
});
