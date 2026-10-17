import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/**
 * Exists only to give this page a title.
 *
 * The page itself is a client component, and Next.js allows `metadata` only
 * in a server one, so every signed-in page shared the root layout's bare
 * "Zoryvex". That made browser tabs indistinguishable, browser history
 * useless, and every navigation announce the same title to a screen reader -
 * which is what WCAG 2.4.2 exists to prevent.
 *
 * The title matches the page's own visible heading, so the tab, the history
 * entry and the h1 all say the same thing.
 */
export const metadata: Metadata = { title: 'Billing diagnostic — Zoryvex' };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
