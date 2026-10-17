import type { PublicProof } from '@zoryvex/contracts';

/**
 * The carryable mark: an SVG a candidate can put on a repository README, a
 * personal site, or anywhere else that renders an image.
 *
 * The design decision that makes it ours is the same one the in-app mark
 * makes: **it has a date on it, and a count.** Verification badges
 * conventionally say "Verified" and imply permanence, which is a lie about
 * how credentials work. This one says how many proofs are live and when they
 * were last checked, so a badge that has gone stale looks stale rather than
 * looking exactly like a fresh one.
 *
 * It is generated rather than stored, from the same read the public page
 * uses, so it can never disagree with the page it links to. A badge cached
 * as a file would keep asserting a number after a credential lapsed, which
 * is a "trust me" that updates itself never.
 *
 * Deliberately plain: no gradient, no gloss, no tick. Square caps, one
 * emerald, the product's own ink and warm tones. It has to sit on somebody
 * else's page without embarrassing them.
 */

/** Same tokens as apps/web/app/globals.css. Not a second visual language. */
const INK = '#0e1013';
const WARM = '#fbf9f5';
const EMERALD = '#0b6b4f';
const MUTED = '#8d94a1';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** "1 September 2026" — the date a reader can compare against today. */
function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** The most recent check on the page, which is what "as of" means here. */
function lastCheckedAt(proof: PublicProof): string | null {
  let latest: string | null = null;
  for (const entry of proof.proofs) {
    if (latest === null || entry.verifiedAt > latest) latest = entry.verifiedAt;
  }
  return latest;
}

export function renderProofBadge(proof: PublicProof): string {
  const count = proof.proofs.length;
  const checked = lastCheckedAt(proof);

  // A candidate with nothing proved yet gets an honest badge rather than no
  // badge. "0 proofs" is a true statement and a reason to come back; a badge
  // that silently rendered as verified would be the enemy in SVG form.
  const headline = count === 1 ? '1 proof' : `${count} proofs`;
  const sub = checked ? `checked ${formatDate(checked)}` : 'nothing checked yet';

  // Monospace digits keep the two lines from reflowing as the count grows.
  const width = 232;
  const height = 44;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(`Zoryvex: ${headline}, ${sub}`)}">
  <title>${escapeXml(`Zoryvex: ${headline}, ${sub}`)}</title>
  <rect width="${width}" height="${height}" rx="6" fill="${INK}"/>
  <polygon points="14,13 30,13 30,17 21,17 30,27 30,31 14,31 14,27 23,27 14,17" fill="${WARM}"/>
  <rect x="38" y="12" width="1.5" height="20" fill="${count > 0 ? EMERALD : MUTED}"/>
  <text x="50" y="22" fill="${WARM}" font-family="ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif" font-size="13" font-weight="700">${escapeXml(headline)}</text>
  <text x="50" y="35" fill="${MUTED}" font-family="ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif" font-size="10">${escapeXml(sub)}</text>
</svg>
`;
}
