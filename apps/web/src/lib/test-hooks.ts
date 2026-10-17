'use client';

import { useEffect } from 'react';
import { getLocalAdapters } from '@zoryvex/local-adapters';

declare global {
  interface Window {
    __zoryvexLocalAdapters?: ReturnType<typeof getLocalAdapters>;
  }
}

/**
 * Exposes the local (fake, fictional-data-only) adapters on `window` for
 * Playwright e2e tests to read — e.g. the sign-in code an email adapter
 * "sent," since there is no real inbox to check. Deliberately always on:
 * this whole build runs against local demo data with no real secret behind
 * it, so there's nothing sensitive to gate this on an environment check for.
 * The founder/admin view (docs/ARCHITECTURE.md candidate app slice) is the
 * human-facing equivalent of this same data.
 */
export function useExposeLocalAdaptersForTests(): void {
  useEffect(() => {
    window.__zoryvexLocalAdapters = getLocalAdapters();
  }, []);
}
