import type { Metadata } from 'next';
import { SignInForm } from '@/components/auth/SignInForm';
import { PageHeader, Section } from '@/components/layout/Section';

export const metadata: Metadata = { title: 'Founder/admin sign in — Zoryvex' };

export default function AdminSignInPage() {
  return (
    <main id="main-content" tabIndex={-1} className="outline-none">
      <Section className="max-w-md">
        <PageHeader title="Founder/admin sign in" />
        <SignInForm
          intendedRole="admin"
          landingHref="/admin"
          demoEmails={['founder.demo@example.com']}
        />
      </Section>
    </main>
  );
}
