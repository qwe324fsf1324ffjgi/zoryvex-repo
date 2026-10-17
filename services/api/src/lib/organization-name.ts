import { ANONYMOUS_EMAIL_DOMAINS } from '@zoryvex/contracts';

/**
 * The name an organization is given when its first admin signs up.
 *
 * There is no organization-name field anywhere in sign-up: an employer gives
 * an email address and nothing else, so this name is a guess either way. The
 * question is only which guess is least wrong, and the previous one was
 * wrong in a way that reached candidates.
 *
 * It used to be built from the local part, so `jane@acme.com` became "Jane's
 * organization". That string is not decoration. It is emailed to every
 * candidate whose proof that employer opens ("Jane's organization looked at
 * your proof on Zoryvex"), so the effect was to tell strangers the personal
 * half of a work address while never once naming the company. Every employer
 * in the TEST database carries a name of that shape, because nothing in the
 * product can set a different one.
 *
 * The domain is the better guess. It is the half of a work address that
 * actually identifies the organization, and for a work address it is usually
 * the company's own name.
 *
 * Two cases are deliberately left alone rather than guessed at:
 *
 * - A free provider. `jane@gmail.com` would become "Gmail", which is worse
 *   than the old behaviour rather than better, so those keep the old form.
 *   ANONYMOUS_EMAIL_DOMAINS is reused from the peer-verification rules
 *   rather than duplicated, so the two cannot drift apart.
 * - Anything with no dot in it, which is not a domain we can read.
 *
 * The first label is taken, so `acme.co.uk` gives "Acme" and a subdomain
 * like `mail.acme.com` gives "Mail". That last one is wrong, and no
 * heuristic fixes it: taking the last label before the suffix gives "Co" for
 * `acme.co.uk`, which is worse. This is a default, not an answer, and the
 * real fix is letting an employer set their own name — see ADR/DECISIONS for
 * why that endpoint does not exist yet.
 */
export function organizationNameFromEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  const atIndex = normalized.lastIndexOf('@');
  const localPart = (atIndex > 0 ? normalized.slice(0, atIndex) : normalized) || 'there';
  const domain = atIndex > 0 ? normalized.slice(atIndex + 1) : '';

  if (domain.includes('.') && !ANONYMOUS_EMAIL_DOMAINS.includes(domain)) {
    const label = domain.split('.')[0];
    if (label) return titleCase(label);
  }

  return `${titleCase(localPart)}'s organization`;
}

/** Capitalises each hyphen- or dot-separated word, so `acme-corp` reads "Acme-Corp". */
function titleCase(value: string): string {
  return value
    .split(/([-.])/)
    .map((part) =>
      part === '-' || part === '.' ? part : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join('');
}
