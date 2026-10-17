import type { InputHTMLAttributes } from 'react';
import { forwardRef } from 'react';
import { cn } from '@/lib/cn';
import { FormField, fieldDescribedBy } from './FormField';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ id, label, hint, error, required, className, ...props }, ref) => {
    return (
      <FormField id={id} label={label} hint={hint} error={error} required={required}>
        <input
          ref={ref}
          id={id}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={fieldDescribedBy(id, hint, error)}
          className={cn(
            // min-h-11 for the same reason Button carries it: py-2 on 14px
            // text lands around 38px, which is comfortable under a mouse and
            // small under a thumb. The padding is unchanged and the floor
            // only affects the fields that were under it.
            'min-h-11 w-full rounded-md border border-ink-500 bg-warm-50 px-3 py-2 text-ink-950',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600',
            error && 'border-error-700',
            className,
          )}
          {...props}
        />
      </FormField>
    );
  },
);
Input.displayName = 'Input';
