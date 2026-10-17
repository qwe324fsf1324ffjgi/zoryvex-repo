import type { Metadata } from 'next';
import { Card } from '@/components/ui/Card';
import { PageHeader, Section } from '@/components/layout/Section';
import { LINKEDIN_URL, WHATSAPP_URL } from '@/lib/contact';
import { PAYSTACK_DISCLOSURE } from '@/lib/pricing';

export const metadata: Metadata = { title: 'Contact — Zoryvex' };

const CHANNELS = [
  { name: 'WhatsApp', url: WHATSAPP_URL, description: 'Message the founder directly.' },
  { name: 'LinkedIn', url: LINKEDIN_URL, description: 'Connect or message on LinkedIn.' },
];

export default function ContactPage() {
  return (
    <Section>
      <PageHeader
        title="Contact"
        intro="These are the only two ways to reach Zoryvex. Both links open the provider's own site: you're leaving Zoryvex when you click either one."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {CHANNELS.map((channel) => (
          <Card key={channel.name}>
            <h2 className="font-semibold text-ink-950">{channel.name}</h2>
            <p className="mt-1 text-sm text-ink-700">{channel.description}</p>
            <a
              href={channel.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block text-sm font-medium text-accent-700"
            >
              Open {channel.name} (leaves Zoryvex, opens in a new tab)
            </a>
          </Card>
        ))}
      </div>
      <p className="mt-8 text-sm text-ink-500">{PAYSTACK_DISCLOSURE}</p>
    </Section>
  );
}
