'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { getLocalAdapters } from '@zoryvex/local-adapters';
import { Button } from '@/components/ui/Button';
import { Wordmark } from '@/components/ui/Wordmark';
import { isRealApiConfigured, realAuth } from '@/lib/real-api';

const LINKS = [
  { href: '/admin/exceptions', label: 'Exception queue (real backend)' },
  { href: '/admin/billing', label: 'Billing diagnostic' },
];

export function AdminNav() {
  const router = useRouter();
  // See CandidateNav. Written out twice here before, which is also why it
  // was the nav where adding a third link would most easily have been
  // inconsistent with the first two.
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    // A native <details> keeps its own open state, so without this a tapped
    // link navigates and leaves the menu open over the new page.
    if (menu.current) menu.current.open = false;
  }, [pathname]);

  /**
   * Founder sign-in still runs on the local fake, but the two admin pages
   * behind this nav read the real backend with a real founder_admin
   * session, so signing out has to revoke that too. Calling the real
   * endpoint when one is configured costs nothing when no real session
   * exists — the handler is idempotent — and closes the gap where clearing
   * local storage looked like signing out and was not.
   */
  async function handleSignOut() {
    if (isRealApiConfigured()) {
      await realAuth.signOut();
    } else {
      getLocalAdapters().auth.signOut();
    }
    router.replace('/admin/sign-in');
  }

  return (
    <header className="border-b border-warm-200 bg-warm-50">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <Link prefetch={false} href="/admin" className="text-lg">
          <Wordmark />
          <span className="ml-1.5 font-medium text-ink-500">&middot; Admin</span>
        </Link>
        <nav aria-label="Admin" className="hidden md:block">
          <ul className="flex items-center gap-4">
            {LINKS.map((link) => {
              const isCurrent = pathname === link.href;
              return (
                <li key={link.href}>
                  <Link
                    prefetch={false}
                    href={link.href}
                    aria-current={isCurrent ? 'page' : undefined}
                    className={cn(
                      'inline-block py-2 text-sm',
                      isCurrent
                        ? 'font-medium text-ink-950 underline underline-offset-4'
                        : 'text-ink-700 hover:underline active:text-ink-950',
                    )}
                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
            <li>
              <Button variant="secondary" onClick={() => void handleSignOut()}>
                Sign out
              </Button>
            </li>
          </ul>
        </nav>

        {/*
          The same mobile menu as the candidate and employer bars. This one
          needed it most: "Exception queue (real backend)" is the longest
          label in any nav in the product, and two of them plus a button in
          one flat row is well over a phone's width.

          The landmark wraps the <details> rather than sitting inside it.
          Inside, the only navigation on the page would be the collapsed
          content, which is out of the accessibility tree until the menu is
          opened: at phone width the page then exposed no navigation landmark
          at all, and `getByRole('navigation')` found nothing. Wrapping keeps
          exactly one navigation exposed at every width, because the other
          one is display:none rather than collapsed.
        */}
        <nav aria-label="Admin" className="md:hidden">
          <details ref={menu}>
            <summary
              className={cn(
                'list-none rounded-md border border-ink-950 px-3 py-2 text-sm font-medium text-ink-950',
                'transition-colors hover:bg-warm-100 active:bg-warm-200',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600',
                '[&::-webkit-details-marker]:hidden',
              )}
              aria-label="Open menu"
            >
              Menu
            </summary>
            <ul className="mt-2 flex flex-col gap-1">
              {LINKS.map((link) => {
                const isCurrent = pathname === link.href;
                return (
                  <li key={link.href}>
                    <Link
                      prefetch={false}
                      href={link.href}
                      aria-current={isCurrent ? 'page' : undefined}
                      className={cn(
                        'block rounded-md px-3 py-2 text-sm transition-colors',
                        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600',
                        isCurrent
                          ? 'bg-warm-100 font-medium text-ink-950'
                          : 'text-ink-700 hover:bg-warm-100 hover:text-ink-950 active:bg-warm-200',
                      )}
                    >
                      {link.label}
                    </Link>
                  </li>
                );
              })}
              <li className="mt-1">
                <Button variant="secondary" className="w-full" onClick={() => void handleSignOut()}>
                  Sign out
                </Button>
              </li>
            </ul>
          </details>
        </nav>
      </div>
    </header>
  );
}
