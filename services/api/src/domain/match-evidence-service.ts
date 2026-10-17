import type {
  AccessState,
  AttemptHistory,
  Evidence,
  EvidenceStrength,
  GradedAttemptRecord,
  Match,
  PeerAttestation,
  PeerRelationship,
  Role,
  VerificationMethod,
} from '@zoryvex/contracts';
import { grantsMarketplaceAccess } from './billing-state';
import { NotFoundError } from '../errors/typed-errors';
import { isVerified } from './matching-service';
import { evidenceStrength } from './evidence-strength-service';
import { describeAttempts, numberInOrder, summariseAttempts } from './attempt-history-service';
import { publicVerificationUrl, redactSourceIdentity } from './verification-source';

/**
 * What an employer is actually buying: not that a candidate is "verified",
 * but what was checked, by whom, and when.
 *
 * The match rationale names evidence by id ("supported by verified evidence
 * ev_1"), which is a database key and means nothing to the person paying.
 * This is the same facts in a form they can judge.
 *
 * Read fresh on demand rather than denormalized onto the Match. A copy stored
 * at recompute time would go stale the moment a candidate re-verified or
 * withdrew an item, and stale claims about what was verified are exactly the
 * failure this product cannot afford.
 */

/**
 * What an employer sees of a confirmation.
 *
 * Deliberately narrower than the stored record and narrower than
 * PublicPeerAttestation: the internal ids are database keys with no meaning to
 * a reader, and a shape that carries them invites somebody to render one.
 */
export interface EmployerVisibleAttestation {
  verifierDomain: string;
  relationship: PeerRelationship;
  statement: string;
  confirmedAt: string;
}

export interface VerifiedEvidenceSummary {
  evidenceId: string;
  claim: string;
  context: string;
  actions: string;
  outcome: string;
  method: VerificationMethod;
  /** Human-readable record of the check, e.g. the certification name and issuer. */
  detail: string;
  /**
   * Whether an independent third party can be checked for this item at all.
   *
   * Separate from `sourceUrl` because the two answer different questions,
   * and collapsing them lost one. `null` used to mean both "there is no
   * third party to check with" (a graded task) and "there is one and you
   * are not entitled to it", which left the unentitled employer unable to
   * tell a limit of the evidence from a limit of their plan.
   */
  sourceAvailable: boolean;
  /**
   * Where the employer can re-run the check at the source, without an
   * account and without Zoryvex in the middle.
   *
   * `null` when there is no third party to check with — never a
   * Zoryvex-hosted link dressed up as an independent one — and also `null`
   * when the organization has no marketplace access. The address is the
   * paid artifact: it is what lets somebody verify the candidate without
   * Zoryvex, so handing it to an employer whose subscription lapsed hands
   * over the product itself. Withheld on the server, never hidden in the
   * client, because a value present in a response is public whatever the
   * page does with it.
   */
  sourceUrl: string | null;
  verifiedAt: string;
  /**
   * What this evidence actually establishes, and what Zoryvex cannot
   * establish at all.
   *
   * Here rather than only on the candidate's own page because this is the
   * screen somebody pays to read. An employer looking at a shortlist should
   * be able to see that one item was corroborated against a source the
   * candidate does not control and another was a credential somebody else
   * issued, rather than seeing both as "verified" and being left to guess.
   */
  strength: EvidenceStrength;
  /** Every confirmation recorded against this claim, in the words given. */
  peerAttestations: EmployerVisibleAttestation[];
  /**
   * For a graded task, what happened across the candidate's submissions.
   *
   * `null` for every other method, and deliberately not an empty history: an
   * issuer badge has no attempts, and showing "no graded attempt recorded"
   * against a certification would read as something missing rather than
   * something that never applied.
   *
   * Not a score, and not ranked on. Three attempts is not worse than one, and
   * an employer who wants to weigh it can, on facts rather than on a number
   * Zoryvex made up.
   */
  attempts: AttemptHistory | null;
  /** The same history in one line, for a reader who will not open the list. */
  attemptSummary: string | null;
}

export interface MatchEvidenceDependencies {
  clock: { now(): Date };
  /**
   * Whether this organization's subscription currently grants anything.
   *
   * The same question `contact-unlock-service` asks, answered by the same
   * derivation, deliberately: a second way of deciding who has paid is a
   * second way of getting it wrong. Derived from the subscription on every
   * read rather than stored, so a grace window closing or a cancelled
   * period running out takes effect immediately instead of whenever
   * something next wakes up to notice.
   */
  getMarketplaceAccess(employerId: string): Promise<AccessState>;
  getRole(roleId: string): Promise<{ role: Role; version: number } | null>;
  getMatch(roleId: string, candidateId: string): Promise<Match | null>;
  listCandidateEvidence(candidateId: string): Promise<Evidence[]>;
  /**
   * Confirmations recorded against one claim. Queried per supporting item
   * rather than for the whole profile: the supporting set is bounded by the
   * role's requirement count, and a page that loaded every attestation a
   * candidate ever received would grow without limit.
   */
  listAttestationsForEvidence(evidenceId: string): Promise<PeerAttestation[]>;
  /**
   * Bounded the same way: verification-service refuses a sixth attempt per
   * evidence item, so this returns at most five rows.
   */
  listGradedAttempts(candidateId: string, evidenceId: string): Promise<GradedAttemptRecord[]>;
}

/**
 * Ownership-checked, and deliberately narrow: only evidence that is
 * currently verified, currently non-private, AND currently supporting this
 * match is returned.
 *
 * Each of those three is checked at read time rather than trusted from the
 * match record. A candidate who hides an item or loses a verification stops
 * showing it to the employer immediately, without waiting for a recompute,
 * and a certification that lapsed yesterday stops being shown as proof
 * today. Contact details are never part of this shape at any point.
 */
export async function getMatchEvidence(
  employerId: string,
  roleId: string,
  candidateId: string,
  deps: MatchEvidenceDependencies,
): Promise<VerifiedEvidenceSummary[]> {
  const roleResult = await deps.getRole(roleId);
  if (!roleResult || roleResult.role.employerId !== employerId) {
    throw new NotFoundError('Role not found');
  }

  const match = await deps.getMatch(roleId, candidateId);
  if (!match) throw new NotFoundError('Match not found');

  const supporting = new Set(match.matchedEvidenceIds ?? []);
  if (supporting.size === 0) return [];

  const evidence = await deps.listCandidateEvidence(candidateId);
  const now = deps.clock.now();

  // What an unpaid organization may see, and what it may not.
  //
  // Two founder instructions meet here, and the reconciliation is in the
  // word "check". "Any user who hasnt paid should not be able to check any
  // repository or any evidence" is satisfied by withholding the ability to
  // verify at the source, which is the thing the subscription sells. It does
  // not require blinding the buyer to whether proof exists at all.
  //
  // Refusing the read outright was tried, between 8a9a9e6 and here, and it
  // made the product unsellable. All an unpaid employer could then see was a
  // score and a rationale naming evidence by database key, which this file's
  // own header already calls meaningless to the person paying. Nobody can
  // reasonably spend NGN 800,000 a month to find out whether the proof is
  // any good, and the pricing page promises they "can judge the reasoning".
  //
  // So the claim, the method, the date and the strength go to anyone who
  // owns the role, and the address of the independent record goes only to an
  // organization whose subscription currently grants access.
  // `redactSourceIdentity` keeps the repository's identity out of the words
  // as well as out of the link.
  //
  // Asked once for the whole list rather than per item, because it is the
  // same answer for every row. Checked after ownership, so an employer
  // probing somebody else's role still gets NotFoundError whether or not
  // they have paid: answering "you need a subscription" there would confirm
  // the role exists.
  const entitled = grantsMarketplaceAccess(await deps.getMarketplaceAccess(employerId));

  const summaries = evidence
    .filter(
      (item) => supporting.has(item.id) && item.visibility !== 'private' && isVerified(item, now),
    )
    .map(async (item) => {
      const method = item.verificationMethod ?? 'issuer_badge';
      const [attestations, attemptRecords] = await Promise.all([
        deps.listAttestationsForEvidence(item.id),
        // Only asked for where it can exist. A badge or a repository check
        // has no rubric and no attempts, and querying for them would be a
        // read per item for a list that is always empty.
        method === 'graded_task'
          ? deps.listGradedAttempts(candidateId, item.id)
          : Promise.resolve([]),
      ]);
      const history =
        method === 'graded_task' ? summariseAttempts(numberInOrder(attemptRecords)) : null;
      // Resolved from the stored reference either way, so that whether a
      // source exists is decided by the evidence and never by the plan.
      const sourceUrl = item.verificationRef
        ? publicVerificationUrl(method, item.verificationRef)
        : null;
      const sourceAvailable = sourceUrl !== null;

      // Withholding the address is not enough on its own. A repository
      // check's own detail sentence names `owner/repo`, which is the
      // address with github.com taken off the front, and
      // `evidence-strength-service` interpolates that same sentence into
      // its basis text. Redacting the stored field once means the summary
      // and every string derived from it are covered together.
      // Empty counts as absent, not as a detail. `??` alone let a stored
      // empty string through, and an employer who had paid was shown a blank
      // line where the record of the check belongs. Found against the
      // deployed test environment, where a fixture stores exactly that.
      const rawDetail =
        item.verificationDetail && item.verificationDetail.trim().length > 0
          ? item.verificationDetail
          : 'Checked by Zoryvex.';
      // Live again, and the reason the preview is safe to show: an unpaid
      // reader gets the sentence with the repository's identity removed, so
      // "a public repository with 7 commit(s) credited to them" survives and
      // "owner/repo" does not. Without this the preview would hand over the
      // address in prose while the link beside it was null.
      //
      // Only where there is an address to protect. `sourceAvailable` false
      // means `publicVerificationUrl` could not build one, so the reference
      // is not a usable repository path and nothing in the sentence can be
      // the address. Redacting anyway did real harm: an item whose
      // reference would not resolve had its honest "Checked by Zoryvex."
      // replaced with "A public repository the candidate proved control
      // of.", which asserts a repository this product could not resolve.
      // Found against the deployed test environment, not in a unit test.
      const detail =
        entitled || !sourceAvailable
          ? rawDetail
          : redactSourceIdentity(method, item.verificationRef, rawDetail);
      const strengthSource = entitled ? item : { ...item, verificationDetail: detail };
      return {
        evidenceId: item.id,
        claim: item.claim,
        context: item.context,
        actions: item.actions,
        outcome: item.outcome,
        // Optional on the schema so older rows keep parsing, but an item
        // that reached `verified` through verification-service always has
        // them. The fallbacks exist so a pre-verification row can never
        // crash an employer's page, and they deliberately claim less rather
        // than more.
        method,
        detail,
        sourceAvailable,
        // The release point. `sourceAvailable` above says an independent
        // record exists; this hands over its address, and only to an
        // organization whose subscription currently grants access.
        sourceUrl: entitled ? sourceUrl : null,
        verifiedAt: item.verifiedAt ?? item.updatedAt,
        // Derived from the same clock the filter above used, so the strength
        // shown can never disagree with the decision to show the item.
        strength: evidenceStrength(strengthSource, now, { peerAttested: attestations.length > 0 }),
        /**
         * What the person actually said, and where they said it from. An
         * employer reading "peer verified" without being able to see who and
         * in what words is being asked to take a badge on trust, which is the
         * thing this product refuses to do anywhere else.
         */
        peerAttestations: attestations.map((a) => ({
          verifierDomain: a.verifierDomain,
          relationship: a.relationship,
          statement: a.statement,
          confirmedAt: a.confirmedAt,
        })),
        attempts: history,
        attemptSummary: history ? describeAttempts(history) : null,
      };
    });

  return Promise.all(summaries);
}
