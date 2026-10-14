import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { apiFetch } from '@/shared/api/api-client';
import { buttonVariants } from '@/shared/ui/button';
import { useSessionStore } from '../session/use-session.ts';
import { AuthLayout, FormMessage, linkClass, StateMessage } from './auth-layout';
import {
  focusFirstInvalid,
  isStatus,
  isUnreachable,
  serverFieldErrors,
  UNREACHABLE,
  type FieldErrors,
} from './form-utils';
import { validateNewPassword, type NewPassword } from '../lib/password-rules-model.ts';
import { NewPasswordFields } from './new-password-fields';
import { SubmitButton } from './submit-button';

const FIELDS = ['password', 'confirm'] as const;
type Field = (typeof FIELDS)[number];

export const RESET_EXPIRED = 'This reset link has expired or was already used.';

/** F02-R9: new password from a reset link; missing token or 410 → the expired state. */
export function ResetPasswordPage() {
  const { token } = useSearch({ from: '/reset-password' });
  const session = useSessionStore();
  const navigate = useNavigate();
  const [value, setValue] = useState<NewPassword>({ password: '', confirm: '' });
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [formError, setFormError] = useState('');
  const [expired, setExpired] = useState(!token);
  const [pending, setPending] = useState(false);
  const refs = useRef<Partial<Record<Field, HTMLInputElement | null>>>({});

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setFormError('');
    const next = validateNewPassword(value);
    setErrors(next);
    if (next.password || next.confirm) return focusFirstInvalid(FIELDS, next, refs.current);
    setPending(true);
    try {
      await apiFetch('/api/auth/reset-password', { body: { token, password: value.password } });
      session.setNotice('password-updated');
      await navigate({ to: '/login', replace: true });
    } catch (err) {
      setPending(false);
      if (isStatus(err, 410, 404)) return setExpired(true);
      if (isUnreachable(err)) return setFormError(UNREACHABLE);
      const server = serverFieldErrors(err);
      if (server.password) {
        setErrors({ password: server.password });
        refs.current.password?.focus();
      } else {
        setFormError(err instanceof Error ? err.message : UNREACHABLE);
      }
    }
  }

  if (expired) {
    return (
      <AuthLayout title="Reset password">
        <StateMessage
          action={
            <Link
              to="/forgot-password"
              className={buttonVariants({ className: 'h-11 w-full rounded-tile' })}
            >
              Request a new link
            </Link>
          }
        >
          {RESET_EXPIRED}
        </StateMessage>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Reset password">
      <p className="mb-5 text-[13px] leading-relaxed text-text-muted">Choose a new password.</p>
      {formError && <FormMessage tone="error">{formError}</FormMessage>}
      <form noValidate onSubmit={onSubmit}>
        <NewPasswordFields
          idPrefix="reset"
          value={value}
          onChange={setValue}
          errors={errors}
          passwordRef={(el) => {
            refs.current.password = el;
          }}
          confirmRef={(el) => {
            refs.current.confirm = el;
          }}
        />
        <SubmitButton pending={pending}>{pending ? 'Saving…' : 'Set new password'}</SubmitButton>
      </form>
      <div className="mt-5 text-center">
        <Link to="/login" className={linkClass}>
          Back to sign in
        </Link>
      </div>
    </AuthLayout>
  );
}
