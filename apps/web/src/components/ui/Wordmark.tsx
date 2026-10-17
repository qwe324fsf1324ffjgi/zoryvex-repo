import { cn } from '@/lib/cn';

/**
 * The brand mark is typographic only — no icon. Confident weight and tight
 * tracking carry the identity; font-size is intentionally left to the
 * caller (inherited from a sized wrapper) so this renders correctly at
 * every placement without a class-order conflict.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('font-extrabold tracking-tight text-ink-950', className)}>Zoryvex</span>
  );
}
