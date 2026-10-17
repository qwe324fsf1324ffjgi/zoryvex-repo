import type { Metadata } from 'next';
import { Card } from '@/components/ui/Card';
import { ButtonLink } from '@/components/ui/Button';
import { PageHeader, Section } from '@/components/layout/Section';

export const metadata: Metadata = {
  title: 'Sign in — Zoryvex',
  description: 'Sign in to Zoryvex with a one-time link sent to your email address.',
};

export default function SignInChooserPage() {
  return (
    <Section className="max-w-2xl">
      <PageHeader title="Sign in" />
      <div className="grid gap-6 sm:grid-cols-2">
        <Card>
          <h2 className="font-semibold text-ink-950">I'm a candidate</h2>
          <p className="mt-2 text-sm text-ink-700">Build or manage your proof profile.</p>
          <ButtonLink href="/candidate/sign-in" className="mt-4">
            Candidate sign in
          </ButtonLink>
        </Card>
        <Card>
          <h2 className="font-semibold text-ink-950">I'm an employer</h2>
          <p className="mt-2 text-sm text-ink-700">Run a role diagnostic or manage your Kit.</p>
          <ButtonLink href="/employer/sign-in" className="mt-4">
            Employer sign in
          </ButtonLink>
        </Card>
      </div>
    </Section>
  );
}
