import type { PublicProof } from '@zoryvex/contracts';
import { apiRequest } from './client';

/**
 * The one read in this client that belongs to nobody.
 *
 * Every other module here sends the session cookie because it is asking for
 * something about the signed-in person. This asks for a page a candidate
 * chose to publish, so the opaque id in the URL is the whole credential and
 * a reader needs no account at all. That is the point: a page only members
 * can see is not a page anybody can carry.
 */
export async function getPublicProof(publicProofId: string): Promise<PublicProof> {
  return apiRequest(`/public/proof/${encodeURIComponent(publicProofId)}`);
}

/** Where the badge image lives, for the snippet a candidate copies. */
export function badgeUrl(apiBaseUrl: string, publicProofId: string): string {
  return `${apiBaseUrl.replace(/\/$/, '')}/public/proof/${encodeURIComponent(publicProofId)}/badge.svg`;
}
