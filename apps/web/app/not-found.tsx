import type { Metadata } from 'next';
import Link from 'next/link';
import { ButtonLink } from '@/components/ui/Button';
import { PageHeader, Section } from '@/components/layout/Section';
import { SiteNav } from '@/components/layout/SiteNav';
import { SiteFooter } from '@/components/layout/SiteFooter';

export const metadata: Metadata = { title: 'Page not found — Zoryvex' };

/**
 * Root-level 404. Without this file Next.js serves its own bare default:
 * black text on white, none of this site's palette, no navigation, and no
 * way back — a dead end for anyone who mistypes a URL or follows a stale
 * link. Rendered inside the root layout only (not the `(marketing)` group's
 * layout), so the nav and footer are composed explicitly here.
 */
export default function NotFound() {
  return (
    <>
      <SiteNav />
      <main id="main-content" tabIndex={-1} className="outline-none">
        <Section className="max-w-2xl">
          <PageHeader
            title="That page doesn't exist"
            intro="The link may be out of date, or the address may have a typo in it. Nothing is wrong with your account."
          />
          <div className="flex flex-wrap gap-3">
            <ButtonLink href="/">Go to the homepage</ButtonLink>
            <ButtonLink href="/sign-in" variant="secondary">
              Sign in
            </ButtonLink>
          </div>
          <p className="mt-8 text-sm text-ink-700">
            Looking for something specific? Start with{' '}
            <Link prefetch={false} href="/for-employers" className="text-accent-700 underline">
              hiring for a role
            </Link>{' '}
            or{' '}
            <Link prefetch={false} href="/for-talent" className="text-accent-700 underline">
              building a proof profile
            </Link>
            . If you think this page should exist,{' '}
            <Link prefetch={false} href="/contact" className="text-accent-700 underline">
              tell us
            </Link>
            .
          </p>
        </Section>
      </main>
      <SiteFooter />
    </>
  );
}
