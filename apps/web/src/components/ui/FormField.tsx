import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface FormFieldProps {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  required?: boolean | undefined;
  children: ReactNode;
}

export function FormField({ id, label, hint, error, required, children }: FormFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink-950">
        {label}
        {required && (
          <span aria-hidden="true" className="text-error-700">
            {' '}
            *
          </span>
        )}
        {required && <span className="sr-only"> (required)</span>}
      </label>
      {hint && (
        <p id={hintId} className="text-sm text-ink-700">
          {hint}
        </p>
      )}
      {children}
      {error && (
        <p id={errorId} role="alert" className={cn('text-sm text-error-700')}>
          {error}
        </p>
      )}
    </div>
  );
}

export function fieldDescribedBy(id: string, hint?: string, error?: string): string | undefined {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}
