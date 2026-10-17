import type { MetadataRoute } from 'next';
import { PUBLIC_ROUTES, siteOrigin } from '@/lib/site';

/**
 * The public marketing pages, and only those.
 *
 * Empty when this build has no site origin, because a sitemap of relative
 * URLs is not a sitemap - every entry has to be absolute for a crawler to
 * use it, and offering a malformed one is worse than offering none.
 */
export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();
  if (!origin) return [];

  const lastModified = new Date();
  return PUBLIC_ROUTES.map((route) => ({
    url: `${origin}${route === '/' ? '' : route}`,
    lastModified,
    // The homepage is the entry point; the rest are equally weighted
    // because guessing a hierarchy among twelve pages is noise, not signal.
    priority: route === '/' ? 1 : 0.7,
  }));
}
