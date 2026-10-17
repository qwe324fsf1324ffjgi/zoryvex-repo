'use client';

import { useState } from 'react';
import { isRealApiConfigured } from '@/lib/real-api';

/**
 * The banner that says what kind of build the reader is looking at.
 *
 * Three states, because there are three builds and they are not
 * interchangeable:
 *
 *   production  nothing. A real product does not caveat itself, and a live
 *               site telling paying customers it is a test environment is
 *               worse than no banner at all.
 *   test        a real backend, real sign-in, real matching — but not the
 *               live product and not real people's data.
 *   local       every candidate, employer and role is invented.
 *
 * Until 2026-09-11 there were only two, keyed on whether the real API was
 * configured at all. That was written when test was the only environment
 * with a real API, so the "real, non-production test environment" wording
 * was accurate. Production then went live with the same build flag set, and
 * announced itself to its own customers as a non-production test.
 *
 * `NEXT_PUBLIC_ENVIRONMENT` is read rather than inferred from the API URL,
 * because inferring it means parsing a hostname and being wrong the first
 * time a domain changes.
 */
export function FictionalDataBanner() {
  const [dismissed, setDismissed] = useState(false);

  // Read at build time, like every other NEXT_PUBLIC_ value in a static
  // export. Anything other than an explicit "production" is treated as not
  // production: a missing or misspelled value shows a caveat that is
  // merely unnecessary, where the opposite mistake hides one that matters.
  const isProduction = process.env.NEXT_PUBLIC_ENVIRONMENT === 'production';

  if (isProduction || dismissed) return null;

  return (
    <div className="bg-ink-950 px-4 py-2 text-center text-sm text-warm-50">
      <span>
        {isRealApiConfigured()
          ? 'This build is connected to a real, non-production test environment. Candidate and employer sign-in, roles, and matching are real. The admin overview has no live metrics yet and shows none.'
          : 'Local demo build. Every candidate, employer, and role shown is fictional test data, not a real person or company.'}
      </span>{' '}
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="ml-2 inline-flex min-h-6 items-center underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-400"
      >
        Dismiss
      </button>
    </div>
  );
}
