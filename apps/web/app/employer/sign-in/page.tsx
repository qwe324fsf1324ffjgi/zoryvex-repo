import type { Metadata } from 'next';
import { SignInForm } from '@/components/auth/SignInForm';
import { PageHeader, Section } from '@/components/layout/Section';

export const metadata: Metadata = { title: 'Employer sign in — Zoryvex' };

export default function EmployerSignInPage() {
  return (
    <main id="main-content" tabIndex={-1} className="outline-none">
      <Section className="max-w-md">
        <PageHeader title="Employer sign in" />
        <SignInForm
          intendedRole="employer"
          landingHref="/employer"
          demoEmails={['hiring.demo@example.com', 'talent.demo@example.com']}
        />
      </Section>
    </main>
  );
}
