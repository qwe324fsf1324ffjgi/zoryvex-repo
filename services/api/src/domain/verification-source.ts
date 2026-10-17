import type { VerificationMethod } from '@zoryvex/contracts';

/**
 * The public address where an employer can re-run our check themselves.
 *
 * This exists because of what the market actually fears. Fake and
 * AI-assisted candidates are now the top anticipated hiring problem of 2026,
 * ahead of talent shortage, and Gartner expects one in four candidate
 * profiles worldwide to be fake by 2028. A platform answering that with
 * "verified, trust us" is asking for exactly the trust the buyer has just
 * learned not to give.
 *
 * So Zoryvex does not ask. Every verified item carries the issuer's own
 * public record, and an employer who doubts a badge can open Credly or
 * GitHub and see it for themselves, without an account and without us in the
 * middle. The check is reproducible by the person paying for it, which is a
 * different and much stronger claim than a badge on a profile.
 *
 * Built from the stored reference rather than a URL captured at verification
 * time: a stored link could be edited, and a link is exactly the field an
 * attacker would want control of. The reference is what the check actually
 * ran against.
 */
export function publicVerificationUrl(
  method: VerificationMethod,
  verificationRef: string,
): string | null {
  const ref = verificationRef.trim();
  if (ref.length === 0) return null;

  switch (method) {
    case 'issuer_badge': {
      // The assertion id, as parsed from the candidate's badge link.
      if (!/^[0-9a-f-]{36}$/i.test(ref)) return null;
      return `https://www.credly.com/badges/${ref.toLowerCase()}`;
    }
    case 'repo_ownership': {
      // owner/repo, as recorded from GitHub's own full_name.
      if (!/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(ref)) return null;
      return `https://github.com/${ref}`;
    }
    case 'graded_task':
      // Scored by Zoryvex against a published rubric, so there is no third
      // party to check with. Returning null is the honest answer; inventing
      // a Zoryvex-hosted link here would dress up our own word as an
      // independent source, which is the whole thing this function exists
      // to avoid.
      return null;
    default:
      return null;
  }
}

/**
 * The same detail sentence with the repository's identity taken out.
 *
 * Withholding `sourceUrl` on its own does not withhold the source. A
 * repository check stores its detail as "owner/repo, a public repository
 * owned by owner with 84 commit(s) credited to them", and `owner/repo` is
 * the address: github.com plus that string is the page. An employer without
 * marketplace access who was handed the sentence had the link, and could
 * reach it by typing. Found by looking at the rendered screen rather than at
 * the response shape, which is the only place it was visible.
 *
 * `evidence-strength-service` interpolates the same sentence into its
 * `basis` text, so the redaction is applied to the stored item once and
 * everything derived from it inherits it, rather than being repeated at each
 * of the three places that render it and forgotten at a fourth.
 *
 * A badge detail is "AWS Certified Solutions Architect, confirmed with AWS"
 * and carries no part of its Credly address, which is keyed by an assertion
 * UUID. Nothing is removed there, because removing it would cost the
 * employer the name of the credential and protect nothing.
 *
 * Fails closed: anything that does not match the known sentence, or that
 * still contains the reference afterwards, collapses to a fixed line with no
 * identity in it at all.
 */
export function redactSourceIdentity(
  method: VerificationMethod,
  verificationRef: string | undefined,
  detail: string,
): string {
  if (method !== 'repo_ownership') return detail;

  const ref = (verificationRef ?? '').trim();
  const generic = 'A public repository the candidate proved control of.';
  if (ref.length === 0) return detail;

  const owner = ref.split('/')[0] ?? '';
  // Anchored on the stored reference rather than on a guessed shape, so a
  // sentence about a different repository can never be mistaken for this one.
  const known = new RegExp(
    `^${escapeForRegExp(ref)}, a public repository owned by ${escapeForRegExp(owner)} with (.+)$`,
    'i',
  );
  const match = known.exec(detail.trim());
  const redacted = match
    ? `A public repository the candidate proved control of, with ${match[1]}`
    : generic;

  // The check that matters. Whatever the sentence looked like, the reference
  // must not survive into it, and neither must the account name on its own.
  return mentions(redacted, ref) || mentions(redacted, owner) ? generic : redacted;
}

function mentions(text: string, needle: string): boolean {
  return needle.length > 0 && text.toLowerCase().includes(needle.toLowerCase());
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
