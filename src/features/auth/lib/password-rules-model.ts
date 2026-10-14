import { passwordSchema } from '@shared/contract/password-policy.ts';

export interface PasswordRule {
  /** The shared schema's message for this rule (stable id). */
  message: string;
  label: string;
}

/** "Password must be at least 8 characters" → "8+ characters"; "…contain a letter" → "A letter". */
function shortLabel(message: string): string {
  const s = message
    .replace(/^Password must (?:be |contain )/, '')
    .replace(/^at least (\d+) /, '$1+ ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * F02-R12: the rules come from the shared `passwordSchema` (D-018): an empty string fails every
 * check, so its issues are the rule list, and a value meets a rule when that issue is absent.
 */
export const PASSWORD_RULES: PasswordRule[] = (
  passwordSchema.safeParse('').error?.issues ?? []
).map(({ message }) => ({ message, label: shortLabel(message) }));

export function unmetRules(value: string): Set<string> {
  return new Set(passwordSchema.safeParse(value).error?.issues.map((i) => i.message) ?? []);
}

export const MISMATCH = "Passwords don't match";

export interface NewPassword {
  password: string;
  confirm: string;
}

/** Field errors for a new password + confirm (rules from the shared schema, F02-R12). */
export function validateNewPassword({ password, confirm }: NewPassword) {
  const errors: { password?: string; confirm?: string } = {};
  if (unmetRules(password).size) errors.password = 'Password doesn’t meet the rules below';
  if (!confirm) errors.confirm = 'Confirm your password';
  else if (confirm !== password) errors.confirm = MISMATCH;
  return errors;
}
