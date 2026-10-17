import { missingContactForDiscovery, type Candidate, type Evidence } from '@zoryvex/contracts';
import { Card } from '@/components/ui/Card';
import { ButtonLink } from '@/components/ui/Button';
import { proofMarkState } from '@/components/ui/ProofMark';

/**
 * Where this candidate actually stands, and what the next step is.
 *
 * The threshold has always existed and was never stated.
 * `recomputeMatchesForRole` writes no match at all for a candidate with no
 * verified evidence supporting a requirement — not a match scored zero, no
 * match — so somebody with an account, a full profile and nothing checked is
 * invisible to every employer, and nothing on their screen said so. They
 * would reasonably conclude the product was empty rather than that they
 * were outside it.
 *
 * Three things decide visibility, all of them in the code rather than in
 * copy: the discovery opt-in (`listDiscoveryOptedCandidates` queries by it),
 * at least one live proof (`isVerified` re-checks the expiry against the
 * clock on every read), and that proof not being private (every filter reads
 * `visibility !== 'private'`). This panel computes exactly those three and
 * names whichever one is missing.
 *
 * The door is deliberately visible and deliberately not lowered. There is no
 * plan that makes an unchecked claim count and no "an admin said so"
 * verification method, so the only way through is to have something checked.
 * An entry requirement that can be waived is not a threshold, it is a queue.
 */

export interface ThresholdPanelProps {
  discoveryOptIn: boolean;
  evidence: Evidence[];
  /**
   * The channels an employer would reach them on. Absent on the local demo
   * path, where the panel keeps its previous behaviour rather than
   * inventing a requirement the fake store cannot satisfy.
   */
  contact?: Pick<Candidate, 'phone' | 'linkedinUrl' | 'websiteUrl'>;
  now?: Date;
}

interface Standing {
  heading: string;
  body: string;
  next: { label: string; href: string } | null;
  tone: 'in' | 'out';
}

export function thresholdStanding(
  discoveryOptIn: boolean,
  evidence: Evidence[],
  now: Date = new Date(),
  contact?: Pick<Candidate, 'phone' | 'linkedinUrl' | 'websiteUrl'>,
): Standing {
  const shareable = evidence.filter((item) => item.visibility !== 'private');
  const live = shareable.filter((item) => proofMarkState(item, now) === 'proved');
  const lapsed = shareable.filter((item) => proofMarkState(item, now) === 'lapsed');
  const privateProofs = evidence.filter(
    (item) => item.visibility === 'private' && proofMarkState(item, now) === 'proved',
  );

  /**
   * The next step points at a specific claim, not at the check page in the
   * abstract.
   *
   * `/candidate/evidence/verify` with no `id` is a failure state: the page
   * has nothing to check and says so. Sending somebody there from a panel
   * whose whole job is "here is what to do next" would hand them an error
   * screen as the answer, and a test asserting only the URL would not
   * notice.
   */
  const checkHref = (item: Evidence | undefined) =>
    item ? `/candidate/evidence/verify?id=${item.id}` : '/candidate/profile';

  if (evidence.length === 0) {
    return {
      tone: 'out',
      heading: 'Employers cannot see you yet',
      body: 'Nothing here has been checked, so no employer search reaches you. File your first claim in four lines, submit it, and one proof puts you in.',
      next: { label: 'File your first claim', href: '/candidate/evidence/new' },
    };
  }

  if (live.length === 0 && lapsed.length > 0) {
    return {
      tone: 'out',
      heading: 'Your proof has lapsed',
      body: `${lapsed.length === 1 ? 'The credential behind your proof' : 'The credentials behind your proofs'} stopped being current, so ${lapsed.length === 1 ? 'it' : 'they'} stopped counting the same day. That is not a penalty. It is what "checked" has to mean. Renew it at the issuer, then check it again here.`,
      next: { label: 'Check it again', href: checkHref(lapsed[0]) },
    };
  }

  if (live.length === 0 && privateProofs.length > 0) {
    return {
      tone: 'out',
      heading: 'Your only proof is private',
      body: 'A private item is yours alone: it never reaches an employer, and it does not count toward being findable. Change one to "visible to matched employers" and you are in.',
      next: { label: 'Open your claims', href: '/candidate/profile' },
    };
  }

  if (live.length === 0) {
    return {
      tone: 'out',
      heading: 'You are at the door',
      body: `${evidence.length === 1 ? 'Your claim is filed' : `${evidence.length} claims are filed`} and none of them has been checked yet. A claim scores nothing. That is the whole product, and one check is what puts you in front of employers.`,
      next: {
        label: 'Submit a claim to be checked',
        href: checkHref(shareable.find((item) => proofMarkState(item, now) === 'unproved')),
      },
    };
  }

  if (!discoveryOptIn) {
    return {
      tone: 'out',
      heading: `${live.length} proof${live.length === 1 ? '' : 's'}, and nobody can see ${live.length === 1 ? 'it' : 'them'}`,
      body: 'You have cleared the only bar that matters and employer discovery is switched off, so no search reaches you. Turn it on below whenever you want to be found, and off again the moment you do not.',
      next: null,
    };
  }

  /**
   * Reachability, checked last because it is the only bar that has nothing
   * to do with proof.
   *
   * An employer spends one of a metered monthly allowance to reach
   * somebody, so being findable now means being contactable. This sits
   * after the proof checks deliberately: telling a candidate with nothing
   * verified to add a phone number would answer a question they had not
   * reached yet.
   */
  const missingContact = contact ? missingContactForDiscovery(contact) : [];
  if (missingContact.length > 0) {
    const needsBoth = missingContact.length === 2;
    return {
      tone: 'out',
      heading: needsBoth
        ? 'Employers cannot reach you yet'
        : missingContact[0] === 'phone'
          ? 'Add a phone number to be found'
          : 'Add somewhere your work can be seen',
      body: needsBoth
        ? 'Your proof is good. An employer pays to reach you and gets one contact from it, so a phone number and a link to your work are both needed before you appear in a search. Add them on this page and you are in.'
        : missingContact[0] === 'phone'
          ? 'Your proof is good and your work is linked. A phone number is the last thing: an employer pays to reach you, and an email address on its own is the one most likely to go unanswered.'
          : 'Your proof is good and you can be reached. One link to where your work lives is the last thing, either a site of your own or your LinkedIn profile.',
      next: null,
    };
  }

  return {
    tone: 'in',
    heading: `You are in, on ${live.length} proof${live.length === 1 ? '' : 's'}`,
    /**
     * Where interest turns up, said on the screen a candidate opens most.
     *
     * An employer saying yes writes to a match row, and until they open
     * Matches that is the only place it exists. Somebody who has just been
     * told they are findable has no reason to guess that a second screen is
     * where the answer arrives, so it is named here rather than left to be
     * discovered.
     */
    body: `Employers hiring for your track can find you, and every one of them sees exactly what was checked, who it was checked with, and when it stops being true. When one is interested, it appears under Matches and we email you, so check there now and then. ${lapsed.length > 0 ? `${lapsed.length} of your other ${lapsed.length === 1 ? 'proof has' : 'proofs have'} lapsed and stopped counting.` : 'More proofs mean more roles you match, not a higher rank on the same one.'}`,
    next: { label: 'Open your matches', href: '/candidate/matches' },
  };
}

export function ThresholdPanel({ discoveryOptIn, evidence, contact, now }: ThresholdPanelProps) {
  const standing = thresholdStanding(discoveryOptIn, evidence, now, contact);

  return (
    <Card
      className={standing.tone === 'in' ? 'border-accent-700' : undefined}
      role="status"
      aria-live="polite"
    >
      <h2 className="font-semibold text-ink-950">{standing.heading}</h2>
      <p className="mt-2 text-sm text-ink-700">{standing.body}</p>
      {standing.next && (
        <ButtonLink href={standing.next.href} className="mt-4" variant="secondary">
          {standing.next.label}
        </ButtonLink>
      )}
    </Card>
  );
}
