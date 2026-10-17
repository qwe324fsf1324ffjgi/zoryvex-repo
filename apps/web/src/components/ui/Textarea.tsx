import type { TextareaHTMLAttributes } from 'react';
import { forwardRef } from 'react';
import { cn } from '@/lib/cn';
import { FormField, fieldDescribedBy } from './FormField';

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ id, label, hint, error, required, className, rows = 4, ...props }, ref) => {
    return (
      <FormField id={id} label={label} hint={hint} error={error} required={required}>
        <textarea
          ref={ref}
          id={id}
          rows={rows}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={fieldDescribedBy(id, hint, error)}
          className={cn(
            'w-full rounded-md border border-ink-500 bg-warm-50 px-3 py-2 text-ink-950',
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
Textarea.displayName = 'Textarea';
