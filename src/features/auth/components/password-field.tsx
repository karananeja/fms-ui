import { forwardRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { TextField, type TextFieldProps } from './text-field';

/** Password input with a show/hide toggle (F02-R7). */
export const PasswordField = forwardRef<HTMLInputElement, Omit<TextFieldProps, 'type'>>(
  function PasswordField(props, ref) {
    const [visible, setVisible] = useState(false);
    const Icon = visible ? EyeOff : Eye;
    return (
      <TextField
        ref={ref}
        {...props}
        type={visible ? 'text' : 'password'}
        adornment={
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
            aria-controls={props.id}
            className="grid size-9 place-items-center rounded-md text-text-faint outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon className="size-4" aria-hidden />
          </button>
        }
      />
    );
  },
);
