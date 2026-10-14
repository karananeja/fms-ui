import { Check, Circle } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { PASSWORD_RULES, unmetRules } from '../lib/password-rules-model.ts';

/** Live checklist under the new-password field; each rule turns to a check as it is met. */
export function PasswordRules({ id, value }: { id: string; value: string }) {
  const unmet = unmetRules(value);
  return (
    <ul id={id} aria-label="Password rules" className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
      {PASSWORD_RULES.map(({ message, label }) => {
        const met = !unmet.has(message);
        const Icon = met ? Check : Circle;
        return (
          <li
            key={message}
            data-met={met}
            className={cn('flex items-center gap-1.5 text-xs', met ? 'text-ok' : 'text-text-faint')}
          >
            <Icon className={cn('size-3.5', !met && 'size-2.5')} aria-hidden />
            {label}
            <span className="sr-only">{met ? ' (met)' : ' (not met)'}</span>
          </li>
        );
      })}
    </ul>
  );
}
