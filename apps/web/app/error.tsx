'use client';

import { useEffect } from 'react';
import { Button, ButtonLink } from '@/components/ui/Button';
import { PageHeader, Section } from '@/components/layout/Section';

/**
 * Root error boundary. Without this file an uncaught render error leaves the
 * user on Next.js's own bare error screen — or, in a production build, a
 * blank page with no explanation and no way out.
 *
 * The error's own message is deliberately never rendered: it can carry
 * internal details (paths, ids, upstream responses) that mean nothing to a
 * candidate or employer and shouldn't be shown to them. It goes to the
 * browser console instead, where a developer can still read it.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled application error:', error);
  }, [error]);

  return (
    <main id="main-content" tabIndex={-1} className="outline-none">
      <Section className="max-w-2xl">
        <PageHeader
          title="Something went wrong on this page"
          intro="This one is on us, not on you. Nothing you had already saved has been lost."
        />
        <div className="flex flex-wrap gap-3">
          <Button onClick={reset}>Try this page again</Button>
          <ButtonLink href="/" variant="secondary">
            Go to the homepage
          </ButtonLink>
        </div>
        {error.digest && (
          <p className="mt-8 text-sm text-ink-700">
            If you report this, quote reference{' '}
            <span className="font-mono text-ink-950">{error.digest}</span> so we can find the exact
            failure in our logs.
          </p>
        )}
      </Section>
    </main>
  );
}
