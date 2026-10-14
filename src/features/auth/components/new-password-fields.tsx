import { useState } from 'react';
import { PasswordField } from './password-field';
import { MISMATCH, type NewPassword } from '../lib/password-rules-model.ts';
import { PasswordRules } from './password-rules';

/**
 * New password (with the live rules checklist) + confirm. The mismatch shows after the confirm
 * field is blurred (or on submit, through `errors`).
 */
export function NewPasswordFields({
  idPrefix,
  value,
  onChange,
  errors,
  passwordRef,
  confirmRef,
}: {
  idPrefix: string;
  value: NewPassword;
  onChange: (value: NewPassword) => void;
  errors: { password?: string; confirm?: string };
  passwordRef: (el: HTMLInputElement | null) => void;
  confirmRef: (el: HTMLInputElement | null) => void;
}) {
  const [confirmBlurred, setConfirmBlurred] = useState(false);
  const rulesId = `${idPrefix}-rules`;
  const liveMismatch =
    confirmBlurred && value.confirm !== '' && value.confirm !== value.password
      ? MISMATCH
      : undefined;
  return (
    <>
      <PasswordField
        ref={passwordRef}
        id={`${idPrefix}-password`}
        label="New password"
        autoComplete="new-password"
        value={value.password}
        onChange={(e) => onChange({ ...value, password: e.target.value })}
        error={errors.password}
        hint={<PasswordRules id={rulesId} value={value.password} />}
        hintId={rulesId}
      />
      <PasswordField
        ref={confirmRef}
        id={`${idPrefix}-confirm`}
        label="Confirm password"
        autoComplete="new-password"
        value={value.confirm}
        onChange={(e) => onChange({ ...value, confirm: e.target.value })}
        onBlur={() => setConfirmBlurred(true)}
        error={errors.confirm ?? liveMismatch}
      />
    </>
  );
}
