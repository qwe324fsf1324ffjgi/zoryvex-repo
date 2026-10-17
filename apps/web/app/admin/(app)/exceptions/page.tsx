'use client';

import { useEffect, useState } from 'react';
import type { AuditEvent } from '@zoryvex/contracts';
import { Card } from '@/components/ui/Card';
import { PageHeader, Section } from '@/components/layout/Section';
import { Skeleton } from '@/components/ui/PageLoading';
import { isRealApiConfigured, RealApiError, realAdmin } from '@/lib/real-api';
import { isSignedOut, messageFor } from '@/lib/real-api/error-message';

type LoadState =
  | { status: 'not-configured' }
  | { status: 'loading' }
  | { status: 'error'; error: RealApiError | Error }
  | { status: 'loaded'; events: AuditEvent[] };

/**
 * Reads the real `services/api`, as the candidate and employer flows now do
 * too — this was the first page to, which an older comment here described as
 * the only one.
 *
 * `GET /admin/exceptions` requires a founder_admin session with a *recent*
 * WebAuthn step-up. Neither half of that has an interface yet: SignInForm
 * routes founder_admin to local fakes, and the four WebAuthn routes are
 * deployed with nothing in the app that calls them. So a 401/403 here is
 * currently the only outcome a real build can produce, and the message below
 * says so rather than suggesting a sign-in that cannot be performed. Tracked
 * in docs/RISK_REGISTER.md.
 */
export default function AdminExceptionsPage() {
  const [state, setState] = useState<LoadState>(
    isRealApiConfigured() ? { status: 'loading' } : { status: 'not-configured' },
  );

  useEffect(() => {
    if (!isRealApiConfigured()) return;
    let cancelled = false;
    realAdmin
      .listExceptions()
      .then((events) => {
        if (!cancelled) setState({ status: 'loaded', events });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Section>
      <PageHeader
        title="Exception queue (real backend)"
        intro="Live audit events from the real services/api, not the local fake. Anything needing a person is listed first. This is the most recent events, not a complete list of outstanding items."
      />

      {state.status === 'not-configured' && (
        <Card>
          <p className="text-sm text-ink-700">
            No real API is configured for this build (NEXT_PUBLIC_API_BASE_URL is unset), so this
            page has nothing to show. Every other admin view uses local-fake data as usual.
          </p>
        </Card>
      )}

      {state.status === 'loading' && (
        <Card role="status" aria-live="polite" className="animate-pulse">
          <span className="sr-only">Loading…</span>
          <Skeleton className="w-1/3" />
          <Skeleton className="mt-3 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-4/5" />
        </Card>
      )}

      {state.status === 'error' && (
        <Card role="alert">
          <p className="text-sm text-ink-700">
            {isSignedOut(state.error)
              ? 'This needs a founder-admin session that has passed a WebAuthn step-up. That step-up has no interface yet, so there is currently no way to open this view in a real build.'
              : `Could not load exceptions: ${messageFor(state.error, 'the request did not complete. Try again in a moment.')}`}
          </p>
        </Card>
      )}

      {state.status === 'loaded' &&
        (state.events.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-700">No audit events yet.</p>
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {state.events.map((event) => (
              <li key={event.id}>
                <Card>
                  <p className="text-sm font-medium text-ink-950">
                    {event.action} · {event.targetType} {event.targetId.slice(0, 10)}
                  </p>
                  <p className="mt-1 text-sm text-ink-700">
                    by {event.actorRole} on {new Date(event.createdAt).toLocaleString()}
                  </p>
                  {event.reason && (
                    <p className="mt-1 text-sm text-ink-700">Reason: {event.reason}</p>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        ))}
    </Section>
  );
}
