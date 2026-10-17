'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MARKETING_NAV_LINKS } from '@/lib/routes';
import { Wordmark } from '@/components/ui/Wordmark';
import { ButtonLink } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

/**
 * The marketing header.
 *
 * A client component now, for two reasons that both come from the same
 * fact: this nav lives in the layout, so it is never remounted when a route
 * changes, and anything it holds in DOM state survives navigation.
 *
 * The mobile menu is a native `<details>`, which keeps its own `open` state
 * on the element. Tapping a link inside it navigated correctly and left the
 * menu sitting open on top of the page that had just loaded — confirmed by
 * driving the running app, not inferred: after navigating, the same
 * `<details>` node was still `open`. Native disclosure is still the right
 * control here (keyboard and screen-reader behaviour for free), so it is
 * closed deliberately on each pathname change rather than replaced.
 *
 * The same hook answers the other half: the nav could not say which page you
 * were on, because nothing in it knew.
 */
export function SiteNav() {
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    // Closed on arrival rather than on click, so it also closes for a
    // back/forward navigation and for anything else that changes the route.
    if (menu.current) menu.current.open = false;
  }, [pathname]);

  /**
   * Current-page marking, on `aria-current` first and appearance second.
   *
   * The underline is what a sighted reader sees, and it is deliberately not
   * colour alone: a slightly darker green among links that are already green
   * is not a distinction anybody can rely on, and is invisible to a good
   * share of readers.
   */
  function currentProps(href: string) {
    const isCurrent = pathname === href;
    return {
      'aria-current': isCurrent ? ('page' as const) : undefined,
      isCurrent,
    };
  }

  return (
    <header className="border-b border-warm-200 bg-warm-50">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link prefetch={false} href="/" className="text-xl">
          <Wordmark />
        </Link>

        <nav aria-label="Primary" className="hidden md:block">
          <ul className="flex items-center gap-6">
            {MARKETING_NAV_LINKS.map((link) => {
              const { isCurrent, ...aria } = currentProps(link.href);
              return (
                <li key={link.href}>
                  <Link
                    prefetch={false}
                    href={link.href}
                    {...aria}
                    className={cn(
                      'inline-block py-2 text-sm font-medium transition-colors',
                      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600',
                      isCurrent
                        ? 'text-ink-950 underline decoration-accent-600 decoration-2 underline-offset-8'
                        : 'text-ink-700 hover:text-ink-950 active:text-ink-950',
                    )}
                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
            <li>
              {/*
                ButtonLink rather than the hand-written classes this used to
                carry. The copy said "button" and the element looked like one,
                but it had none of the component's focus ring and none of its
                pressed state, so it behaved differently from every other
                button on the site for exactly the people who most need the
                feedback.
              */}
              <ButtonLink href="/sign-in">Sign in</ButtonLink>
            </li>
          </ul>
        </nav>

        <details ref={menu} className="md:hidden">
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
          <nav aria-label="Primary" className="mt-2">
            <ul className="flex flex-col gap-1">
              {MARKETING_NAV_LINKS.map((link) => {
                const { isCurrent, ...aria } = currentProps(link.href);
                return (
                  <li key={link.href}>
                    <Link
                      prefetch={false}
                      href={link.href}
                      {...aria}
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
              <li>
                <ButtonLink href="/sign-in" className="w-full">
                  Sign in
                </ButtonLink>
              </li>
            </ul>
          </nav>
        </details>
      </div>
    </header>
  );
}
