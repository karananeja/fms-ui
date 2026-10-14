import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { z } from 'zod';
import { safeRedirect } from '../session/safe-redirect.ts';
import { selectNotice, useSession, useSessionStore } from '../session/use-session.ts';
import { AuthLayout, FormMessage, linkClass } from './auth-layout';
import {
  focusFirstInvalid,
  isStatus,
  isUnreachable,
  UNREACHABLE,
  type FieldErrors,
} from './form-utils';
import { PasswordField } from './password-field';
import { SubmitButton } from './submit-button';
import { TextField } from './text-field';

const FIELDS = ['email', 'password'] as const;
type Field = (typeof FIELDS)[number];

const loginFormSchema = z.object({
  email: z.email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});

const NOTICES = {
  expired: 'Your session has expired. Please sign in again.',
  'password-updated': 'Password updated. Sign in with your new password.',
} as const;

/** F02-R6: the dev account is prefilled in dev builds only (dropped from production bundles). */
const DEV_EMAIL = import.meta.env.DEV
  ? (import.meta.env.VITE_DEV_LOGIN_EMAIL ?? 'superadmin@fms.local')
  : '';

/** F02-R7: sign in, then go to the safe `?redirect=` target. */
export function LoginPage() {
  const session = useSessionStore();
  const notice = useSession(selectNotice);
  const { redirect } = useSearch({ from: '/login' });
  const navigate = useNavigate();
  const [email, setEmail] = useState(DEV_EMAIL);
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState(false);
  const refs = useRef<Partial<Record<Field, HTMLInputElement | null>>>({});

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setFormError('');
    const parsed = loginFormSchema.safeParse({ email: email.trim(), password });
    if (!parsed.success) {
      const next: FieldErrors<Field> = {};
      for (const i of parsed.error.issues) next[i.path[0] as Field] ??= i.message;
      setErrors(next);
      focusFirstInvalid(FIELDS, next, refs.current);
      return;
    }
    setErrors({});
    setPending(true);
    try {
      await session.login(parsed.data.email, parsed.data.password);
      await navigate({ href: safeRedirect(redirect), replace: true });
    } catch (err) {
      setPending(false);
      // Never say which field was wrong (F02-R7).
      setFormError(
        isStatus(err, 401) || !isUnreachable(err) ? 'Invalid email or password.' : UNREACHABLE,
      );
      refs.current.password?.focus();
    }
  }

  return (
    <AuthLayout title="Sign in">
      {notice && !formError && <FormMessage tone="info">{NOTICES[notice]}</FormMessage>}
      {formError && <FormMessage tone="error">{formError}</FormMessage>}
      <form noValidate onSubmit={onSubmit}>
        <TextField
          ref={(el) => {
            refs.current.email = el;
          }}
          id="login-email"
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />
        <PasswordField
          ref={(el) => {
            refs.current.password = el;
          }}
          id="login-password"
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        <div className="-mt-1 mb-4 flex justify-end">
          <Link to="/forgot-password" className={linkClass}>
            Forgot password?
          </Link>
        </div>
        <SubmitButton pending={pending}>{pending ? 'Signing in…' : 'Sign in'}</SubmitButton>
      </form>
    </AuthLayout>
  );
}
