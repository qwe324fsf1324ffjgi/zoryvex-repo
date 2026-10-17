import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader, Section } from '@/components/layout/Section';

export const metadata: Metadata = {
  title: 'Accessibility — Zoryvex',
  description:
    'Zoryvex is built mobile-first, keyboard-complete and screen-reader labelled, targeting WCAG 2.2 AA. What that covers, and where to report a barrier.',
};

export default function AccessibilityPage() {
  return (
    <Section className="max-w-3xl">
      <PageHeader
        title="Accessibility"
        intro="Zoryvex is built mobile-first, keyboard-complete, and screen-reader labeled, targeting WCAG 2.2 AA."
      />
      <div className="space-y-8 text-ink-700">
        <div>
          <h2 className="text-xl font-bold text-ink-950">What we test for</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Every interactive control is reachable and operable by keyboard alone.</li>
            <li>Every form control has a programmatically associated label.</li>
            <li>Color contrast meets WCAG 2.2 AA for text and interactive elements.</li>
            <li>Animation respects your reduced-motion preference.</li>
          </ul>
        </div>
        <div>
          <h2 className="text-xl font-bold text-ink-950">Found a problem?</h2>
          <p className="mt-2">
            If something isn't accessible to you, tell us on the{' '}
            <Link prefetch={false} href="/contact">
              Contact
            </Link>{' '}
            page. Accessibility issues are treated as bugs, not feature requests.
          </p>
        </div>
      </div>
    </Section>
  );
}
