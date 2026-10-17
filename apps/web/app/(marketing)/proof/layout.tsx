import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/**
 * Exists only to give this page a title.
 *
 * The page is a client component - it reads a token or id from the URL -
 * and Next.js allows `metadata` only in a server one, so it inherited the
 * root layout's bare "Zoryvex".
 *
 * This one matters more than most: it is the page a candidate shares.
 * A shared link whose tab reads only the company name tells the person
 * who opened it nothing about what they are looking at. The title stays
 * static and names no candidate, because the page is rendered from an id
 * in the URL and a title cannot be built at export time - and because a
 * name in a tab is a disclosure the page's own consent rules govern.
 */
export const metadata: Metadata = {
  title: 'Verified proof — Zoryvex',
  description:
    'A record of work that was checked against a rubric published in advance, shared by the person who did it.',
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
