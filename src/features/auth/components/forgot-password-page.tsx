import { useRef, useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { MailCheck } from 'lucide-react';
import { forgotPasswordSchema } from '@shared/contract/auth.ts';
import { apiFetch } from '@/shared/api/api-client';
import { AuthLayout, FormMessage, linkClass } from './auth-layout';
import { isUnreachable, UNREACHABLE } from './form-utils';
import { SubmitButton } from './submit-button';
import { TextField } from './text-field';

/**
 * F02-R8: the same confirmation for any 2xx or 4xx, so the screen never reveals which accounts
 * exist; only network/5xx errors are shown.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setFormError('');
    const value = email.trim();
    if (!forgotPasswordSchema.shape.email.safeParse(value).success) {
      setError('Enter a valid email address');
      input.current?.focus();
      return;
    }
    setError('');
    setPending(true);
    try {
      await apiFetch('/api/auth/forgot-password', { body: { email: value } });
      setSentTo(value);
    } catch (err) {
      if (isUnreachable(err)) setFormError(UNREACHABLE);
      else setSentTo(value);
    } finally {
      setPending(false);
    }
  }

  const back = (
    <Link to="/login" className={linkClass}>
      Back to sign in
    </Link>
  );

  if (sentTo !== null) {
    return (
      <AuthLayout title="Check your email">
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent">
            <MailCheck className="size-6" aria-hidden />
          </span>
          <p role="status" className="text-sm leading-relaxed break-words">
            If an account exists for <span className="text-accent">{sentTo}</span>, we&apos;ve sent
            a link to reset the password. The link is valid for 30 minutes.
          </p>
          {back}
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Forgot password">
      <p className="mb-5 text-[13px] leading-relaxed text-text-muted">
        Enter your email and we&apos;ll send you a link to reset your password.
      </p>
      {formError && <FormMessage tone="error">{formError}</FormMessage>}
      <form noValidate onSubmit={onSubmit}>
        <TextField
          ref={input}
          id="forgot-email"
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={error}
        />
        <SubmitButton pending={pending}>{pending ? 'Sending…' : 'Send reset link'}</SubmitButton>
      </form>
      <div className="mt-5 text-center">{back}</div>
    </AuthLayout>
  );
}
