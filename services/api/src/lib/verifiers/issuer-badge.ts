import { createHash } from 'node:crypto';

/**
 * Open Badges v2 assertion verification, the strongest autonomous check
 * available for the four launch tracks.
 *
 * AWS, Google Cloud, the Linux Foundation and HashiCorp all issue their
 * certifications as Credly badges, and Credly publishes each one as a public
 * Open Badges v2 assertion. The assertion's `recipient` carries a SALTED
 * SHA-256 of the holder's email address, which is what makes this genuinely
 * autonomous rather than a link a candidate can paste: we recompute the hash
 * from the email Zoryvex already proved they control (magic-link sign-in)
 * and compare. A candidate cannot pass this by finding somebody else's badge
 * URL.
 *
 * Microsoft is the notable absence, and it is a limitation rather than an
 * oversight. Microsoft stopped issuing certification badges through Credly
 * in 2024; Azure certifications now live only in Microsoft Learn, which
 * offers a shareable transcript for a person to read rather than a
 * credential bound to the holder's address. There is nothing here to check
 * autonomously, so Azure certifications are not offered as a verifiable
 * credential at all. Saying that plainly is the honest option; accepting a
 * pasted transcript link and calling it verified is not.
 *
 * Nothing here is a judgement call, so nothing here needs a human. The same
 * check re-run tomorrow gives the same answer, and re-run after the
 * credential expires gives a different one — which is the point.
 *
 * Field shapes were confirmed against Credly's live public endpoint on
 * 2026-08-27, not assumed. Three things the first draft got wrong or got
 * right only by accident, all corrected below:
 *
 * 1. `badge` is a URI STRING, not an embedded object. Credly returns a link
 *    to the BadgeClass, so reading `assertion.badge.name` gave undefined and
 *    every real credential would have been rejected as unrecognized. The
 *    spec permits both forms, so both are handled.
 * 2. `recipient` carries NO salt. Credly hashes the bare email, and the
 *    first draft only worked because `salt ?? ''` happens to be a no-op.
 *    That is now explicit and tested rather than accidental.
 * 3. `revoked` is simply ABSENT on a valid badge rather than `false`, which
 *    the `=== true` check already handled correctly.
 *
 * Real values seen: issuer "Amazon Web Services Training and Certification",
 * badge "AWS Certified Solutions Architect – Associate" (en dash), identity
 * "sha256$" + 64 hex.
 */

export interface BadgeClass {
  name?: string | undefined;
  issuer?: { name?: string | undefined } | undefined;
}

export interface BadgeAssertion {
  recipient?:
    | {
        type?: string | undefined;
        hashed?: boolean | undefined;
        salt?: string | undefined;
        identity?: string | undefined;
      }
    | undefined;
  /** A URI pointing at the BadgeClass (what Credly returns), or the class inline. */
  badge?: string | BadgeClass | undefined;
  issuedOn?: string | undefined;
  expires?: string | undefined;
  revoked?: boolean | undefined;
}

export type BadgeVerification =
  | { verified: true; badgeName: string; issuerName: string; expiresAt: string | null }
  | { verified: false; reason: string };

/**
 * Which credentials each issuer is allowed to have issued.
 *
 * Scoped per issuer, and that structure is the security property rather than
 * tidiness. This was two independent sets — one of issuer names, one of badge
 * names — and a credential passed when it matched one entry in each, with
 * nothing requiring the two to belong together. While AWS was the only issuer
 * that was harmless. It stops being harmless the moment there is a second
 * one: a badge issued by Google Cloud but named "AWS Certified Solutions
 * Architect – Associate" would satisfy both sets and verify.
 *
 * That is not hypothetical. Badge names on Credly are not unique to the
 * organisation that owns the certification, because training partners issue
 * their own badges carrying the same words. "Certified Kubernetes
 * Administrator (CKA)" exists under The Linux Foundation, who own the exam,
 * and separately under a training company. Confirmed against live badge
 * records on 2026-09-06, not assumed.
 *
 * An unrecognized issuer, or a recognized issuer carrying a name that is not
 * theirs, is refused. Adding either is a deliberate edit here.
 *
 * Every string below is the name as it appears in the machine-readable Open
 * Badges record, which is not always the name on the web page: a Terraform
 * certification's page says "issued by HashiCorp", while the credential
 * itself names IBM Professional Certification, because IBM acquired
 * HashiCorp. Matching the web page would have rejected every real Terraform
 * certification while looking correct in review.
 */
const RECOGNIZED_CREDENTIALS: ReadonlyArray<{
  /** Normalized Open Badges issuer name. */
  readonly issuer: string;
  /** Canonicalized badge names this issuer is trusted for. */
  readonly badges: ReadonlySet<string>;
}> = [
  {
    issuer: 'amazon web services training and certification',
    badges: new Set([
      'aws certified cloud practitioner',
      'aws certified solutions architect associate',
      'aws certified developer associate',
      'aws certified sysops administrator associate',
      'aws certified solutions architect professional',
      'aws certified devops engineer professional',
      'aws certified security specialty',
      'aws certified advanced networking specialty',
      'aws certified machine learning specialty',
      'aws certified machine learning engineer associate',
      'aws certified data engineer associate',
      'aws certified ai practitioner',
    ]),
  },
  {
    // Kept because older AWS credentials carry the shorter issuer name. Same
    // badge set: the shorter name is the same organisation, not a partner.
    issuer: 'amazon web services',
    badges: new Set([
      'aws certified cloud practitioner',
      'aws certified solutions architect associate',
      'aws certified developer associate',
      'aws certified sysops administrator associate',
      'aws certified solutions architect professional',
      'aws certified devops engineer professional',
      'aws certified security specialty',
      'aws certified advanced networking specialty',
      'aws certified machine learning specialty',
      'aws certified machine learning engineer associate',
      'aws certified data engineer associate',
      'aws certified ai practitioner',
    ]),
  },
  {
    // Every name below confirmed to exist on Credly under this issuer on
    // 2026-09-06. Note that Google Cloud publishes most of these with a
    // trailing "Certification" and at least one ("Professional Machine
    // Learning Engineer") without, which is why canonicalBadgeName drops it.
    issuer: 'google cloud',
    badges: new Set([
      'cloud digital leader',
      'associate cloud engineer',
      'associate data practitioner',
      'professional cloud architect',
      'professional cloud developer',
      'professional cloud database engineer',
      'professional cloud devops engineer',
      'professional cloud network engineer',
      'professional cloud security engineer',
      'professional data engineer',
      'professional machine learning engineer',
    ]),
  },
  {
    // The Kubernetes exams, which are the platform credential for the
    // DevOps/platform and cloud-security tracks. The issuer owns the exam;
    // training partners issuing look-alike names are not this issuer and do
    // not reach this list.
    issuer: 'the linux foundation',
    badges: new Set([
      'cka certified kubernetes administrator',
      'ckad certified kubernetes application developer',
      'cks certified kubernetes security specialist',
      'kcna kubernetes and cloud native associate',
      'kcsa kubernetes and cloud native security associate',
    ]),
  },
  {
    // HashiCorp's certifications, issued under IBM since the acquisition.
    // Scoped to exactly these names: IBM Professional Certification issues a
    // great many other credentials, and none of the rest are evidence for
    // these four tracks.
    issuer: 'ibm professional certification',
    badges: new Set([
      'hashicorp certified terraform associate',
      'hashicorp certified terraform authoring and operations professional',
      'hashicorp certified vault associate',
      'hashicorp certified vault operations professional',
      'hashicorp certified consul associate',
    ]),
  },
];

/**
 * Where the badge's name and issuer actually live.
 *
 * Returns the class directly when the assertion embeds it, or the URI to
 * dereference when it does not. The URI is checked against Credly's own host
 * before it is ever returned for fetching: the assertion is upstream data,
 * and following an arbitrary URL out of a response body is the same
 * server-side request forgery hole that parsing the candidate's badge link
 * exists to avoid. A URI pointing anywhere else is refused, not followed.
 */
export function resolveBadgeClass(
  assertion: BadgeAssertion,
): { inline: BadgeClass } | { fetchUri: string } | { reason: string } {
  const badge = assertion.badge;
  if (badge && typeof badge === 'object') return { inline: badge };
  if (typeof badge !== 'string') {
    return { reason: 'The credential does not say which badge it is.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(badge);
  } catch {
    return { reason: 'The credential points at an unreadable badge record.' };
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || (host !== 'api.credly.com' && host !== 'credly.com')) {
    return { reason: 'The credential points at a badge record Zoryvex does not trust.' };
  }
  return { fetchUri: parsed.toString() };
}

/** Lowercase, collapse any dash/punctuation run to a single space. */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‐-―\-–—_]/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A badge name reduced to the credential it names, ignoring how the issuer
 * happened to label this printing of it.
 *
 * Two suffixes vary between real credentials for the same exam, so matching
 * the literal name silently rejects genuine ones:
 *
 * - Google Cloud publishes most certifications as "... Certification" and at
 *   least one ("Professional Machine Learning Engineer") without it. Both
 *   confirmed live on 2026-09-06.
 * - HashiCorp exams carry an exam revision: "HashiCorp Certified: Terraform
 *   Associate (003)" and "(004)" are the same certification, and a new
 *   revision must not stop being recognized the day it ships.
 *
 * The revision strip is deliberately narrow — exactly a trailing run of two
 * to four digits, which is what an exam revision looks like and what no
 * credential name on the list ends with meaningfully. It cannot merge two
 * different certifications, because nothing here distinguishes two
 * credentials by a trailing number alone.
 */
export function canonicalBadgeName(value: string): string {
  return normalizeName(value)
    .replace(/ \d{2,4}$/, '')
    .replace(/ certification$/, '')
    .trim();
}

/**
 * Open Badges v2: `identity` is `"sha256$" + hex(sha256(identifier + salt))`.
 *
 * The salt is OPTIONAL, and Credly does not send one — confirmed against a
 * live assertion, whose recipient has no `salt` key at all. An absent salt
 * means the bare email is hashed, so the empty-string default below is the
 * correct reading of the spec rather than a fallback that happens to work.
 *
 * Compared with a length-independent scan rather than `===` so the check does
 * not leak timing information about how much of the digest matched.
 */
function hashedIdentityMatches(identity: string, salt: string, email: string): boolean {
  const [algorithm, expected] = identity.split('$');
  if (algorithm !== 'sha256' || !expected) return false;
  const actual = createHash('sha256')
    .update(email.trim().toLowerCase() + salt)
    .digest('hex');
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < actual.length; i += 1) {
    difference |= actual.charCodeAt(i) ^ expected.toLowerCase().charCodeAt(i);
  }
  return difference === 0;
}

/**
 * `candidateEmail` must be the address the candidate has already proven
 * control of through sign-in — never a value they supplied with the badge,
 * which would let them claim any badge by naming its owner's email.
 */
export function verifyBadgeAssertion(
  assertion: BadgeAssertion,
  badgeClass: BadgeClass,
  candidateEmail: string,
  now: Date,
): BadgeVerification {
  if (assertion.revoked === true) {
    return { verified: false, reason: 'This credential has been revoked by its issuer.' };
  }

  const issuerName = badgeClass.issuer?.name;
  const recognized = issuerName
    ? RECOGNIZED_CREDENTIALS.find((entry) => entry.issuer === normalizeName(issuerName))
    : undefined;
  if (!issuerName || !recognized) {
    return {
      verified: false,
      reason: `Zoryvex does not currently recognize credentials from "${issuerName ?? 'an unnamed issuer'}".`,
    };
  }

  const badgeName = badgeClass.name;
  // Checked against this issuer's own credentials, never against a shared
  // pool. A name that belongs to a different organisation's certification is
  // refused here even though some other issuer is trusted for it, which is
  // the whole reason the list is scoped by issuer.
  if (!badgeName || !recognized.badges.has(canonicalBadgeName(badgeName))) {
    return {
      verified: false,
      reason: `"${badgeName ?? 'This credential'}" is not a certification Zoryvex verifies from ${issuerName}.`,
    };
  }

  // An absent expiry means a credential that does not expire. A present one
  // must still be in the future: an expired certification is real history but
  // it is not current proof, and matching must not treat it as such.
  const expiresAt = assertion.expires ?? null;
  if (expiresAt !== null) {
    const expiry = Date.parse(expiresAt);
    if (Number.isNaN(expiry)) {
      return { verified: false, reason: 'The credential has an expiry date that cannot be read.' };
    }
    if (expiry <= now.getTime()) {
      return {
        verified: false,
        reason: 'This credential expired on ' + expiresAt.slice(0, 10) + '.',
      };
    }
  }

  const recipient = assertion.recipient;
  if (!recipient?.identity) {
    return { verified: false, reason: 'The credential does not identify who it was issued to.' };
  }
  if (recipient.type !== undefined && recipient.type !== 'email') {
    return {
      verified: false,
      reason: 'Zoryvex can only confirm credentials issued against an email address.',
    };
  }

  const boundToCandidate = recipient.hashed
    ? hashedIdentityMatches(recipient.identity, recipient.salt ?? '', candidateEmail)
    : recipient.identity.trim().toLowerCase() === candidateEmail.trim().toLowerCase();

  if (!boundToCandidate) {
    return {
      verified: false,
      reason:
        'This credential was issued to a different email address than the one on your Zoryvex account.',
    };
  }

  return { verified: true, badgeName, issuerName, expiresAt };
}
