import type { ReactNode, SelectHTMLAttributes } from 'react';
import { forwardRef } from 'react';
import { cn } from '@/lib/cn';
import { FormField, fieldDescribedBy } from './FormField';

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ id, label, hint, error, required, className, children, ...props }, ref) => {
    return (
      <FormField id={id} label={label} hint={hint} error={error} required={required}>
        <select
          ref={ref}
          id={id}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={fieldDescribedBy(id, hint, error)}
          className={cn(
            // Matches Input's floor. A select and a text field sitting in the
            // same form at different heights reads as a mistake before it
            // reads as a size.
            'min-h-11 w-full rounded-md border border-ink-500 bg-warm-50 px-3 py-2 text-ink-950',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600',
            error && 'border-error-700',
            className,
          )}
          {...props}
        >
          {children}
        </select>
      </FormField>
    );
  },
);
Select.displayName = 'Select';
