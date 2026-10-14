import { inputClass } from '@/features/auth/components/text-field';
import { cn } from '@/shared/lib/utils';

/** The optional note sent with an action (max 500, the contract's bound). */
export function NoteField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="mb-3">
      <label htmlFor={id} className="mb-1.5 block text-xs font-bold text-text-muted">
        Note (optional)
      </label>
      <textarea
        id={id}
        value={value}
        maxLength={500}
        rows={2}
        onChange={(e) => onChange(e.target.value)}
        className={cn(inputClass, 'h-auto min-h-16 py-2.5')}
      />
    </div>
  );
}
