import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { LoaderCircle } from 'lucide-react';
import type { z } from 'zod';
import type { inviteInfoSchema } from '@shared/contract/auth.ts';
import { apiFetch } from '@/shared/api/api-client';
import { formatIst } from '@/shared/lib/format-date';
import { buttonVariants } from '@/shared/ui/button';
import { useSessionStore } from '../session/use-session.ts';
import { AuthLayout, FormMessage, StateMessage } from './auth-layout';
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
import { inputClass, TextField } from './text-field';

type InviteInfo = z.infer<typeof inviteInfoSchema>;
const FIELDS = ['name', 'password', 'confirm'] as const;
type Field = (typeof FIELDS)[number];

export const INVITE_INVALID =
  'This invite has expired or is no longer valid. Ask your administrator for a new invite.';
export const INVITE_ACCEPTED = 'This invite was already accepted.';

type View =
  | { kind: 'loading' }
  | { kind: 'ready'; invite: InviteInfo }
  | { kind: 'invalid' }
  | { kind: 'accepted' }
  | { kind: 'unreachable' };

/** F02-R10: the only way to create an account. The server signs the new user in. */
export function AcceptInvitePage() {
  const { token } = useSearch({ from: '/accept-invite' });
  const session = useSessionStore();
  const navigate = useNavigate();
  const [view, setView] = useState<View>(token ? { kind: 'loading' } : { kind: 'invalid' });
  const [name, setName] = useState('');
  const [pw, setPw] = useState<NewPassword>({ password: '', confirm: '' });
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState(false);
  const refs = useRef<Partial<Record<Field, HTMLInputElement | null>>>({});

  useEffect(() => {
    if (!token) return;
    const ctrl = new AbortController();
    apiFetch<InviteInfo>(`/api/auth/invites/${encodeURIComponent(token)}`, { signal: ctrl.signal })
      .then((invite) => setView({ kind: 'ready', invite }))
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        if (isStatus(err, 409)) setView({ kind: 'accepted' });
        else if (isUnreachable(err)) setView({ kind: 'unreachable' });
        else setView({ kind: 'invalid' });
      });
    return () => ctrl.abort();
  }, [token]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending || !token) return;
    setFormError('');
    const next: FieldErrors<Field> = {
      ...(!name.trim() && { name: 'Enter your name' }),
      ...validateNewPassword(pw),
    };
    setErrors(next);
    if (FIELDS.some((f) => next[f])) return focusFirstInvalid(FIELDS, next, refs.current);
    setPending(true);
    try {
      await session.acceptInvite(token, name.trim(), pw.password);
      await navigate({ to: '/live-tracking', replace: true });
    } catch (err) {
      setPending(false);
      if (isStatus(err, 409)) return setView({ kind: 'accepted' });
      if (isStatus(err, 410, 404)) return setView({ kind: 'invalid' });
      if (isUnreachable(err)) return setFormError(UNREACHABLE);
      const server = serverFieldErrors(err);
      const field = FIELDS.find((f) => server[f]);
      if (field) {
        setErrors({ [field]: server[field] });
        refs.current[field]?.focus();
      } else {
        setFormError(err instanceof Error ? err.message : UNREACHABLE);
      }
    }
  }

  const signIn = (
    <Link to="/login" className={buttonVariants({ className: 'h-11 w-full rounded-tile' })}>
      Sign in
    </Link>
  );

  if (view.kind === 'loading') {
    return (
      <AuthLayout title="Accept invite">
        <p
          role="status"
          className="flex items-center justify-center gap-2 py-6 text-sm text-text-muted"
        >
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
          Checking your invite…
        </p>
      </AuthLayout>
    );
  }
  if (view.kind === 'invalid') {
    return (
      <AuthLayout title="Accept invite">
        <StateMessage action={signIn}>{INVITE_INVALID}</StateMessage>
      </AuthLayout>
    );
  }
  if (view.kind === 'accepted') {
    return (
      <AuthLayout title="Accept invite">
        <StateMessage action={signIn}>{INVITE_ACCEPTED}</StateMessage>
      </AuthLayout>
    );
  }
  if (view.kind === 'unreachable') {
    return (
      <AuthLayout title="Accept invite">
        <StateMessage
          action={
            <button
              type="button"
              onClick={() => location.reload()}
              className={buttonVariants({ className: 'h-11 w-full rounded-tile' })}
            >
              Try again
            </button>
          }
        >
          {UNREACHABLE}
        </StateMessage>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Accept invite">
      <p className="mb-5 text-[13px] leading-relaxed text-text-muted">
        Set your name and a password to finish creating your account. This invite expires on{' '}
        <span className="text-text">{formatIst(view.invite.expiresAt)}</span> IST.
      </p>
      {formError && <FormMessage tone="error">{formError}</FormMessage>}
      <form noValidate onSubmit={onSubmit}>
        <div className="mb-4">
          <label htmlFor="invite-email" className="mb-1.5 block text-xs font-bold text-text-muted">
            Email
          </label>
          <input
            id="invite-email"
            type="email"
            readOnly
            autoComplete="username"
            value={view.invite.email}
            className={inputClass}
          />
        </div>
        <TextField
          ref={(el) => {
            refs.current.name = el;
          }}
          id="invite-name"
          label="Name"
          autoComplete="name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
        />
        <NewPasswordFields
          idPrefix="invite"
          value={pw}
          onChange={setPw}
          errors={errors}
          passwordRef={(el) => {
            refs.current.password = el;
          }}
          confirmRef={(el) => {
            refs.current.confirm = el;
          }}
        />
        <SubmitButton pending={pending}>
          {pending ? 'Creating account…' : 'Create account'}
        </SubmitButton>
      </form>
    </AuthLayout>
  );
}
