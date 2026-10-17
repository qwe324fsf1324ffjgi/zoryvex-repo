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
  { href: '/candidate/profile', label: 'Profile' },
  // The candidate half of mutual matching. Without a way in, the roles
  // matched to somebody stay invisible to them and only the employer can
  // ever answer.
  { href: '/candidate/matches', label: 'Matches' },
  { href: '/candidate/profile/preview', label: 'Preview' },
  { href: '/candidate/account', label: 'Account' },
];

/**
 * The signed-in candidate's bar.
 *
 * It used to be one flat flex row at every width, and four links plus a
 * Sign out button do not fit a phone: measured at 408px of content in a
 * 375px viewport, which is a page that scrolls sideways on every screen a
 * signed-in candidate ever sees. `SiteNav` has had a mobile menu since it
 * was written; these three in-app navs never got one.
 *
 * Same native `<details>` as SiteNav rather than a second pattern, and for
 * the same reason it gives keyboard and screen-reader behaviour for free.
 * Closed on every pathname change for the reason SiteNav records: the
 * element keeps its own `open` state, so tapping a link navigated correctly
 * and left the menu sitting open on top of the page that had just loaded.
 */
export function CandidateNav() {
  const router = useRouter();
  // Same treatment SiteNav already carries, which these three in-app navs
  // never got: three identical links and nothing saying which one you are
  // looking at. Signed-in people see this bar on every page, so it is the
  // nav where "where am I" is asked most often.
  //
  // aria-current first, appearance second, and the appearance is an
  // underline plus a darker ink rather than colour on its own.
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    // Closed on arrival rather than on click, so it also closes for a
    // back/forward navigation and for anything else that changes the route.
    if (menu.current) menu.current.open = false;
  }, [pathname]);

  async function handleSignOut() {
    if (isRealApiConfigured()) {
      await realAuth.signOut();
    } else {
      getLocalAdapters().auth.signOut();
    }
    router.replace('/candidate/sign-in');
  }

  const linkClass = (isCurrent: boolean) =>
    cn(
      'inline-block py-2 text-sm font-medium',
      isCurrent
        ? 'text-ink-950 underline underline-offset-4'
        : 'text-ink-700 hover:text-ink-950 active:text-ink-950',
    );

  return (
    <header className="border-b border-warm-200 bg-warm-50">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <Link prefetch={false} href="/candidate/profile" className="text-lg">
          <Wordmark />
        </Link>

        <nav aria-label="Candidate" className="hidden md:block">
          <ul className="flex items-center gap-4">
            {LINKS.map((link) => {
              const isCurrent = pathname === link.href;
              return (
                <li key={link.href}>
                  <Link
                    prefetch={false}
                    href={link.href}
                    aria-current={isCurrent ? 'page' : undefined}
                    className={linkClass(isCurrent)}
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
        <nav aria-label="Candidate" className="md:hidden">
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
