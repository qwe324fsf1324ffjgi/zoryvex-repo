import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

/**
 * Every variant carries a pressed state as well as a hover one.
 *
 * There was no `active:` rule anywhere in the application — confirmed by
 * reading the built stylesheet, which contained zero `:active` rules across
 * 31 interactive elements. On a desktop that is easy to miss, because the
 * pointer is already sitting on the element and the hover shade reads as
 * acknowledgement. On a touch screen there is no hover at all, so a tap
 * produced no visual response whatsoever until whatever it triggered
 * finished. A button that does nothing visible when pressed reads as broken,
 * and the honest reaction is to press it again.
 *
 * One shade darker than hover, and nothing else. No scale transform, no
 * shadow: the press needs to be legible, not performed, and a button that
 * moves under the finger is harder to hit rather than easier.
 */
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-accent-600 text-warm-50 hover:bg-accent-700 active:bg-accent-800 disabled:bg-ink-500',
  secondary:
    'bg-transparent text-ink-950 border border-ink-950 hover:bg-warm-100 active:bg-warm-200 disabled:text-ink-500 disabled:border-ink-500',
  ghost:
    'bg-transparent text-accent-700 hover:bg-warm-100 active:bg-warm-200 disabled:text-ink-500',
  /**
   * The button that ends something, and the only one that should look
   * different from the button that starts something.
   *
   * "Yes, delete everything" was styled `primary`, so the control that
   * permanently destroys an account was the same emerald as Save, Subscribe
   * and Next. The confirmation dialog was carrying the entire weight of
   * telling somebody what they were about to do, and a person who has learned
   * that the green button is the one they want is being invited to misread
   * this one.
   *
   * Colour is not doing this alone. The wording on every use of this variant
   * names the consequence, which is what a person who cannot distinguish
   * these two hues reads instead.
   */
  danger: 'bg-error-700 text-warm-50 hover:bg-error-800 active:bg-error-900 disabled:bg-ink-500',
};

/**
 * A floor on height, not a new size.
 *
 * `py-2` on 14px text produces a control about 36px tall, which is fine under
 * a mouse and small under a thumb. Both platform guidelines that exist put the
 * comfortable minimum at 44 (Apple) or 48 (Material), and WCAG 2.2's 24px
 * floor is a legal minimum rather than a usable one. The padding is kept and a
 * minimum height added underneath it, so nothing that already cleared 44px
 * changes shape and only the small controls grow.
 */
const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: 'min-h-11 px-4 py-2 text-sm',
  lg: 'min-h-12 px-6 py-3 text-base',
};

export function buttonClasses(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className?: string,
): string {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-md font-medium',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600',
    'disabled:cursor-not-allowed',
    'transition-colors',
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    className,
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className, children, ...props }, ref) => {
    return (
      <button ref={ref} className={buttonClasses(variant, size, className)} {...props}>
        {children}
      </button>
    );
  },
);
Button.displayName = 'Button';

export interface ButtonLinkProps {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  target?: AnchorHTMLAttributes<HTMLAnchorElement>['target'];
  rel?: string;
  'aria-label'?: string;
  children: ReactNode;
}

export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(
  ({ variant = 'primary', size = 'md', className, children, href, target, rel, ...props }, ref) => {
    return (
      <Link
        ref={ref}
        href={href}
        target={target}
        rel={rel}
        prefetch={false}
        className={buttonClasses(variant, size, className)}
        {...props}
      >
        {children}
      </Link>
    );
  },
);
ButtonLink.displayName = 'ButtonLink';
