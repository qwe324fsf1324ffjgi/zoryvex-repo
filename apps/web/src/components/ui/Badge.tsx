import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'neutral' | 'accent' | 'error';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-warm-200 text-ink-700',
  accent: 'bg-accent-700 text-warm-50',
  error: 'bg-error-700 text-warm-50',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        TONE_CLASSES[tone],
      )}
    >
      {children}
    </span>
  );
}
