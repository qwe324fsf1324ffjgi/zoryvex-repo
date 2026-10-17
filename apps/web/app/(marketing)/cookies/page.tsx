import type { Metadata } from 'next';
import { PageHeader, Section } from '@/components/layout/Section';
import { isRealApiConfigured } from '@/lib/real-api';

export const metadata: Metadata = {
  title: 'Cookies — Zoryvex',
  description: 'What Zoryvex stores in your browser and why. No advertising or tracking cookies.',
};

export default function CookiesPage() {
  return (
    <Section className="max-w-3xl">
      <PageHeader title="Cookies" />
      <div className="space-y-8 text-ink-700">
        <div>
          <h2 className="text-xl font-bold text-ink-950">No non-essential cookies</h2>
          <p className="mt-2">
            Zoryvex does not use advertising or analytics cookies, and does not track you across
            other sites. Signed-in areas use only what's strictly required to keep you signed in.
          </p>
        </div>
        <div>
          <h2 className="text-xl font-bold text-ink-950">
            {isRealApiConfigured() ? 'Your session cookie' : 'Local storage'}
          </h2>
          <p className="mt-2">
            {isRealApiConfigured()
              ? "Signing in sets one essential, first-party session cookie so you stay signed in between page loads. It's not used for tracking or advertising, and there's no way to opt out of it and remain signed in."
              : "This build stores your session and demo data in your browser's local storage rather than a cookie. It never leaves your device or is sent to a third party."}
          </p>
        </div>
      </div>
    </Section>
  );
}
