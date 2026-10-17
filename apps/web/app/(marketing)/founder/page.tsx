import type { Metadata } from 'next';
import Link from 'next/link';
import { FounderPhoto } from '@/components/ui/FounderPhoto';
import { PageHeader, Section } from '@/components/layout/Section';

export const metadata: Metadata = {
  title: 'Founder — Zoryvex',
  description:
    'Who builds Zoryvex, and why it is built around proof of work rather than around a résumé.',
};

export default function FounderPage() {
  return (
    <Section>
      <PageHeader title="Founder" />
      <div className="flex flex-col gap-8 sm:flex-row sm:items-start">
        <FounderPhoto />
        <div className="max-w-xl">
          <p className="text-ink-700">
            Zerah founded Zoryvex to build a proof-first alternative to keyword-matched hiring for
            cloud engineering, DevOps/platform, cloud-security, and MLOps roles: one where a
            candidate's actual work speaks for itself, and an employer can evaluate that work with a
            structured, repeatable process instead of guesswork.
          </p>
          <p className="mt-4 text-ink-700">
            Zoryvex is early: the product you're using today is the Proof Hiring Kit and a growing
            candidate base, built and operated as a solo effort. Nothing on this site claims more
            traction or scale than that.
          </p>
          <Link
            prefetch={false}
            href="/contact"
            className="mt-4 inline-block text-sm font-medium text-accent-700"
          >
            Get in touch →
          </Link>
        </div>
      </div>
    </Section>
  );
}
