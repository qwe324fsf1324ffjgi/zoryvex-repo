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
  { href: '/employer', label: 'Roles' },
  { href: '/employer/roles/new', label: 'New role' },
  { href: '/employer/billing', label: 'Billing' },
];

/**
 * The signed-in employer's bar.
 *
 * Mobile menu added alongside CandidateNav's, where the same flat row was
 * measured at 408px of content in a 375px viewport. Three links here rather
 * than four, so this one sat closer to the edge than over it, and fixing
 * only the nav that happened to be measured would leave two in-app bars
 * behaving differently on a phone for no reason a reader could see.
 */
export function EmployerNav() {
  const router = useRouter();
  // See CandidateNav: the same current-page marking SiteNav already had and
  // none of the three in-app navs did.
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    // A native <details> keeps its own open state, so without this a tapped
    // link navigates and leaves the menu open over the new page.
    if (menu.current) menu.current.open = false;
  }, [pathname]);

  /**
   * Revokes the server-side session, not just the browser's copy of it.
   *
   * This cleared local storage and stopped there, which on the real backend
   * meant signing out did not sign you out: the httpOnly session cookie and
   * its server record both survived, so the next visit — or anyone else on
   * a shared machine — was still authenticated. The candidate nav had
   * always called the real endpoint; this one had not.
   */
  async function handleSignOut() {
    if (isRealApiConfigured()) {
      await realAuth.signOut();
    } else {
      getLocalAdapters().auth.signOut();
    }
    router.replace('/employer/sign-in');
  }

  return (
    <header className="border-b border-warm-200 bg-warm-50">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <Link prefetch={false} href="/employer" className="text-lg">
          <Wordmark />
        </Link>

        <nav aria-label="Employer" className="hidden md:block">
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
                      'inline-block py-2 text-sm font-medium',
                      isCurrent
                        ? 'text-ink-950 underline underline-offset-4'
                        : 'text-ink-700 hover:text-ink-950 active:text-ink-950',
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
          The landmark wraps the <details> rather than sitting inside
          it. Inside, the only navigation on the page would be the
          collapsed content, which is out of the accessibility tree
          until the menu is opened, so at phone width the page exposed
          no navigation landmark at all. Wrapping keeps exactly one
          exposed at every width, because the other is display:none
          rather than collapsed.
        */}
        <nav aria-label="Employer" className="md:hidden">
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
                        'block rounded-md px-3 py-2 text-sm font-medium transition-colors',
                        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600',
                        isCurrent
                          ? 'bg-warm-100 text-ink-950'
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
