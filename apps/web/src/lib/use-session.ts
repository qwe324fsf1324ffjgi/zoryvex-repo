'use client';

import { useEffect, useState } from 'react';
import { getLocalAdapters } from '@zoryvex/local-adapters';
import type { AccountRole, Session } from '@zoryvex/local-adapters';
import type { AccountRole as RealAccountRole } from '@zoryvex/contracts';
import { isRealApiConfigured, realAuth } from './real-api';
import { retryWithBackoff } from './retry-with-backoff';

/**
 * Local adapters' AccountRole is the simpler UI-facing set the rest of this
 * app's role-gating already understands; the real backend's is the fuller
 * server-issued set (packages/contracts). 'candidate' is identical in both
 * — this mapping only matters once employer/admin real sessions exist too.
 */
function toLocalRole(role: RealAccountRole): AccountRole {
  if (role === 'candidate') return 'candidate';
  if (role === 'founder_admin') return 'admin';
  return 'employer';
}

/** undefined = still loading (first client render), null = signed out. */
export function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    if (isRealApiConfigured()) {
      retryWithBackoff(() => realAuth.getSession())
        .then((context) => {
          if (cancelled) return;
          setSession(
            context === null
              ? null
              : {
                  accountId: context.accountId,
                  role: toLocalRole(context.role),
                  issuedAt: new Date().toISOString(),
                  ...(context.candidateId !== undefined
                    ? { candidateId: context.candidateId }
                    : {}),
                  ...(context.employerId !== undefined ? { employerId: context.employerId } : {}),
                },
          );
        })
        .catch(() => {
          // realAuth.getSession() only ever resolves null for a genuine
          // "not signed in" (401) — reaching this catch means every retry
          // of a real failure (network blip, transient 5xx) was
          // exhausted. Falling back to "signed out" here is recoverable
          // (sign in again) and honest, rather than leaving the page
          // stuck on "Loading…" with no way forward.
          if (!cancelled) setSession(null);
        });
    } else {
      const { auth } = getLocalAdapters();
      setSession(auth.getSession());
    }

    return () => {
      cancelled = true;
    };
  }, []);

  return session;
}
