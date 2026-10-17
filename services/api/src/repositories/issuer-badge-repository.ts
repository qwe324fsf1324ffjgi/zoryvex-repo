import { UpstreamUnavailableError } from '../domain/verification-service';
import type { BadgeAssertion, BadgeClass } from '../lib/verifiers/issuer-badge';

/**
 * Open Badges v2 assertions are published by Credly at a fixed, public path.
 * The URL is built here from a constant plus the UUID the domain already
 * parsed out, so a candidate-supplied string never reaches fetch() — see
 * extractBadgeAssertionId in verification-service.ts for why that matters.
 *
 * Confirmed against the live endpoint on 2026-08-27: a real assertion
 * returns 200 with `badge` as a URI to the BadgeClass, and an absent badge
 * returns 404 with a JSON body. Both paths are handled below. The verifier
 * still rejects anything it does not fully understand, so an unexpected
 * shape fails closed rather than passing something through.
 */
const CREDLY_OBI_BASE = 'https://api.credly.com/v1/obi/v2/badge_assertions';
const REQUEST_TIMEOUT_MS = 5_000;

export async function fetchBadgeAssertion(assertionId: string): Promise<BadgeAssertion | null> {
  return credlyGet<BadgeAssertion>(`${CREDLY_OBI_BASE}/${encodeURIComponent(assertionId)}`);
}

/**
 * The BadgeClass the assertion links to, where the name and issuer live.
 * `uri` has already been checked against Credly's own host by
 * resolveBadgeClass — this function never receives an unvalidated URL.
 */
export async function fetchBadgeClass(uri: string): Promise<BadgeClass | null> {
  return credlyGet<BadgeClass>(uri);
}

async function credlyGet<T>(url: string): Promise<T | null> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'zoryvex-verification' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // A timeout is not evidence about the candidate's credential.
    throw new UpstreamUnavailableError(
      error instanceof Error ? error.message : 'Credly request failed',
    );
  }

  // 404 and 403 both mean "no public record we can read", which is a real
  // answer the candidate can act on (make the badge public).
  if (response.status === 404 || response.status === 403) return null;
  if (response.status === 429 || response.status >= 500) {
    throw new UpstreamUnavailableError(`Credly responded ${response.status}`);
  }
  if (!response.ok) {
    throw new UpstreamUnavailableError(`Credly responded ${response.status}`);
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new UpstreamUnavailableError('Credly returned a body that was not JSON');
  }
}
