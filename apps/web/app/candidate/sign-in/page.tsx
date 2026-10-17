import type { Metadata } from 'next';
import { SignInForm } from '@/components/auth/SignInForm';
import { PageHeader, Section } from '@/components/layout/Section';

export const metadata: Metadata = { title: 'Candidate sign in — Zoryvex' };

export default function CandidateSignInPage() {
  return (
    <main id="main-content" tabIndex={-1} className="outline-none">
      <Section className="max-w-md">
        <PageHeader title="Candidate sign in" />
        <SignInForm
          intendedRole="candidate"
          landingHref="/candidate/profile"
          demoEmails={['amara.demo@example.com', 'ngozi.demo@example.com']}
        />
      </Section>
    </main>
  );
}
