'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { AccountRole } from '@zoryvex/local-adapters';
import { useSession } from '@/lib/use-session';
import { PageLoading } from '@/components/ui/PageLoading';

export interface RoleGuardProps {
  requiredRole: AccountRole;
  signInHref: string;
  children: ReactNode;
}

/**
 * Client-side auth gate: static export has no server to enforce this, so
 * every route inside a guarded layout renders a loading shell until the
 * session check completes, then either the real content or nothing (while
 * redirecting) — never a flash of protected content.
 */
export function RoleGuard({ requiredRole, signInHref, children }: RoleGuardProps) {
  const session = useSession();
  const router = useRouter();
  const authorized = session !== undefined && session !== null && session.role === requiredRole;
  const shouldRedirect = session !== undefined && !authorized;

  useEffect(() => {
    if (shouldRedirect) router.replace(signInHref);
  }, [shouldRedirect, router, signInHref]);

  // Both waiting states carry the same landmark the authorized layout does.
  //
  // The skip link lives in the root layout and is the first thing a keyboard
  // user reaches on every page, but its target only existed once the guard
  // let the real layout render - so on a protected page it pointed at
  // nothing while the session was being checked, and at nothing at all for
  // somebody who was not signed in. A page with no main landmark also leaves
  // everything on it outside a landmark, which is the state assistive
  // technology has the least to say about.
  //
  // These never coexist with the layout's own main: children render only
  // when authorized, so exactly one is present at any moment.
  // The live region is nested rather than applied to the <main> itself.
  // role="status" on a <main> REPLACES its implicit landmark role, so the
  // first version of this fix produced a status region and no main landmark
  // at all - the opposite of what it set out to do, and invisible unless you
  // know that an explicit role overrides an implicit one.
  // The landmark is separated from what fills it, because the two waiting
  // states now need different contents and must not differ in their landmark.
  const shell = (contents: ReactNode) => (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto max-w-4xl px-4 py-12 outline-none sm:px-6"
    >
      {contents}
    </main>
  );

  const waiting = (message: string) => (
    <p role="status" aria-live="polite">
      {message}
    </p>
  );

  // A skeleton for the session check and deliberately not for the redirect
  // below. This one is a page about to appear, so standing in for its shape
  // is honest and stops the layout jumping when it does. The redirect is a
  // page about to be replaced, and drawing the outline of something the
  // reader is being taken away from would be a picture of a lie.
  //
  // PageLoading carries its own role="status" live region, so it is placed
  // directly in the landmark rather than inside `waiting`. Wrapping it would
  // nest two live regions, and the note above about an explicit role
  // overriding an implicit one is the same class of mistake in the other
  // direction.
  if (session === undefined) return shell(<PageLoading blocks={2} />);

  // Rendering nothing here left a blank page for the moment before the
  // redirect lands, which says nothing to anybody and least of all to a
  // screen reader. Short-lived by design, and still worth wording.
  if (!authorized) return shell(waiting('Taking you to sign in…'));

  return <>{children}</>;
}
