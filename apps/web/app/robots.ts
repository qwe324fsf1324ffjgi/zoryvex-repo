import type { MetadataRoute } from 'next';
import { indexingAllowed, siteOrigin } from '@/lib/site';

/**
 * There was no robots.txt at all, which meant TEST - a public hostname
 * serving the whole product - was as crawlable as the real site would be.
 *
 * Fail-closed: every deployment refuses crawlers unless it has been told
 * explicitly that it is the one that should be indexed. Getting a
 * pre-launch environment out of a search index is far more work than
 * keeping it out.
 */
export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  const origin = siteOrigin();

  if (!indexingAllowed()) {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Signed-in surfaces and one-off token links. A crawler following
        // these finds only a sign-in wall, and a public proof page belongs
        // to the person who chose to share it rather than in an index.
        disallow: ['/candidate/', '/employer/', '/admin/', '/auth/', '/proof', '/confirm-work'],
      },
    ],
    ...(origin ? { sitemap: `${origin}/sitemap.xml` } : {}),
  };
}
