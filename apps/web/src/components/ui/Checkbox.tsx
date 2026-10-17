import type { InputHTMLAttributes } from 'react';
import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'> {
  id: string;
  label: string;
  hint?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ id, label, hint, className, ...props }, ref) => {
    const hintId = hint ? `${id}-hint` : undefined;
    return (
      <div className="flex items-start gap-2">
        <input
          ref={ref}
          id={id}
          type="checkbox"
          aria-describedby={hintId}
          className={cn(
            // 16px is a hard box to hit on a phone, and the box is what a
            // thumb aims at first even though the label is clickable too.
            //
            // 24px, not the 20px this used to be, and the reason is a
            // measurement rather than a preference. This previously claimed
            // the clickable label made up the difference and kept the control
            // compliant. Measured with real layout, the box and its label
            // together come to 20px tall, so it did not: WCAG 2.2 SC 2.5.8
            // asks for 24, and the label adds width, not height. At 24 the
            // box meets the floor on its own and the argument is unnecessary.
            //
            // `shrink-0` is what makes the width real. This input is a flex
            // child beside a label and a hint, and without it flex takes the
            // width back: on the candidate profile, where the hints run long,
            // all three boxes rendered 13px wide — narrower than the 16px
            // default this line exists to replace. The height was never
            // affected, which is why it looked right.
            'mt-0.5 h-6 w-6 shrink-0 rounded border-ink-500 text-accent-600',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600',
            className,
          )}
          {...props}
        />
        <div>
          <label htmlFor={id} className="text-sm font-medium text-ink-950">
            {label}
          </label>
          {hint && (
            <p id={hintId} className="text-sm text-ink-700">
              {hint}
            </p>
          )}
        </div>
      </div>
    );
  },
);
Checkbox.displayName = 'Checkbox';
