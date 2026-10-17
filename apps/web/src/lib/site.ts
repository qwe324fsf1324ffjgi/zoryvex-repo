/**
 * What this build believes about where it is deployed.
 *
 * Both values are build-time `NEXT_PUBLIC_*` reads, baked into the static
 * export the same way the API base URL already is. They are separate from
 * the API URL on purpose: the site and the API are different hosts, and
 * deriving one from the other by string surgery is the kind of shortcut
 * that survives until the day the hosts stop matching that pattern.
 */

/** Absolute origin of this deployment, e.g. https://test.zoryvex.space. */
export function siteOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_SITE_URL;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    // A malformed value must not take the build down. Metadata falls back
    // to relative URLs, which is worse for sharing and harmless otherwise.
    return null;
  }
}

/**
 * Whether search engines may index this deployment.
 *
 * Fail-closed, deliberately. TEST serves the same pages as production on a
 * public hostname, and without an explicit opt-in a crawler would index a
 * pre-launch environment - duplicate content against the real site, and a
 * half-finished product in search results with no way to un-say it quickly.
 * Indexing is a decision somebody makes once, at launch, by setting this.
 */
export function indexingAllowed(): boolean {
  return process.env.NEXT_PUBLIC_ALLOW_INDEXING === 'true';
}

/**
 * Public marketing routes, the only pages worth offering a crawler.
 *
 * Everything else is behind the authorizer or is a one-off token link:
 * candidate and employer apps, admin, the auth callback, and the public
 * proof page, which is deliberately absent - a proof page is a link its
 * owner chooses to share, not a document to be indexed and surfaced against
 * their name later.
 */
export const PUBLIC_ROUTES = [
  '/',
  '/for-employers',
  '/for-talent',
  '/pricing',
  '/how-verification-works',
  '/trust-safety',
  '/founder',
  '/contact',
  '/accessibility',
  '/privacy',
  '/terms',
  '/cookies',
] as const;
