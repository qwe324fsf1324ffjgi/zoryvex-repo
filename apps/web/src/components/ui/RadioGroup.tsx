import { cn } from '@/lib/cn';

export interface RadioOption {
  value: string;
  label: string;
  hint?: string;
}

export interface RadioGroupProps {
  name: string;
  legend: string;
  options: RadioOption[];
  value: string | undefined;
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
}

export function RadioGroup({
  name,
  legend,
  options,
  value,
  onChange,
  error,
  required,
}: RadioGroupProps) {
  const errorId = error ? `${name}-error` : undefined;

  return (
    <fieldset aria-describedby={errorId}>
      <legend className="text-sm font-medium text-ink-950">
        {legend}
        {required && (
          <span aria-hidden="true" className="text-error-700">
            {' '}
            *
          </span>
        )}
      </legend>
      <div className="mt-2 flex flex-col gap-2">
        {options.map((option) => {
          const id = `${name}-${option.value}`;
          return (
            <div key={option.value} className="flex items-start gap-2">
              <input
                id={id}
                type="radio"
                name={name}
                value={option.value}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
                required={required}
                className={cn(
                  // Same 24px as Checkbox. These two sit in the same forms and
                  // any difference between them would be arbitrary.
                  //
                  // Including `shrink-0`, for the same reason: as a flex child
                  // beside a label and a hint, this input gives width back
                  // under pressure. It measured 20px only because every radio
                  // label in the product happens to be short, which is not a
                  // property to rely on.
                  'mt-0.5 h-6 w-6 shrink-0 border-ink-500 text-accent-600',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600',
                )}
              />
              <div>
                <label htmlFor={id} className="text-sm font-medium text-ink-950">
                  {option.label}
                </label>
                {option.hint && <p className="text-sm text-ink-700">{option.hint}</p>}
              </div>
            </div>
          );
        })}
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-sm text-error-700">
          {error}
        </p>
      )}
    </fieldset>
  );
}
