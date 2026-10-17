import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { FictionalDataBanner } from '@/components/layout/FictionalDataBanner';
import { OfflineBanner } from '@/components/layout/OfflineBanner';
import { ToastProvider } from '@/components/ui/Toast';
import { indexingAllowed, siteOrigin } from '@/lib/site';

const TITLE = 'Zoryvex';
const DESCRIPTION =
  'Proof-first hiring for cloud engineering, DevOps/platform, cloud-security, and MLOps roles.';

const origin = siteOrigin();

/**
 * Defaults every page inherits and any page may override.
 *
 * There was no openGraph or twitter metadata anywhere, so a link to this
 * product rendered as a bare URL in Slack, LinkedIn, WhatsApp and iMessage -
 * no title, no description, nothing. The product's growth model is a
 * sharing loop on each side, employer and candidate, which makes the
 * unfurled card the first thing most people ever see of it.
 *
 * No image yet: a share image has to be a real raster file at a real size,
 * and shipping a wrong one is worse than shipping none. Title, description
 * and site name are what actually render, and they render everywhere.
 *
 * `robots` mirrors app/robots.ts. robots.txt asks a crawler not to fetch a
 * page; this tells one that already has it not to index it. A pre-launch
 * environment needs both, because they fail in different directions.
 */
export const metadata: Metadata = {
  ...(origin ? { metadataBase: new URL(origin) } : {}),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: TITLE,
  // No title or description here on purpose. Next.js falls back to the
  // page's own `title` and `description` for both openGraph and twitter when
  // they are absent, and stops falling back the moment they are set - so
  // stating them at the root made every shared link, including a candidate's
  // own proof page, unfurl with the homepage sentence. Only what is genuinely
  // site-wide belongs here.
  openGraph: {
    type: 'website',
    siteName: TITLE,
    ...(origin ? { url: origin } : {}),
  },
  twitter: { card: 'summary' },
  ...(indexingAllowed() ? {} : { robots: { index: false, follow: false } }),
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a
          href="#main-content"
          /*
            The one focus ring in the application that was not ours.

            Every other focusable thing carries outline-accent-600, and this
            carried nothing, so it fell back to the browser's own ring: on
            Chrome a 1px auto outline in amber, which is off-palette in a
            product built from ink, warm white and one emerald. It was
            visible, so this is not an accessibility fix. It is the first
            thing a keyboard user meets on every page, and it was the only
            one that looked borrowed.

            `focus:` rather than `focus-visible:` throughout, matching the
            rest of this element: a skip link is reached by keyboard and
            nothing else, so the two are the same here, and mixing them would
            leave the ring appearing at a different moment from the box it
            belongs to.
          */
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-warm-50 focus:px-4 focus:py-2 focus:text-accent-700 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-accent-600"
        >
          Skip to main content
        </a>
        <FictionalDataBanner />
        <OfflineBanner />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
