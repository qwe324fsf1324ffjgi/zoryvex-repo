import type { FeatureFlags } from '@zoryvex/config';
import {
  compensationClears,
  ENGAGEMENT_KIND_PHRASES,
  isContactableForDiscovery,
  LAUNCH_TRACK_LABELS,
  LaunchTrackSchema,
  byStrongestMatch,
} from '@zoryvex/contracts';

/**
 * Re-exported so callers that already import the ranking from this module
 * keep working. The rule itself lives in contracts, because the employer's
 * page ranks the same list and the two must not drift again.
 */
export { byStrongestMatch };
import type { Candidate, Evidence, LaunchTrack, Match, MatchFit, Role } from '@zoryvex/contracts';
import { NotFoundError } from '../errors/typed-errors';
import type { Clock } from '../repositories/clock-repository';
import { evaluateLocationFit } from './location-fit';
import { strongestAcross } from './evidence-strength-service';

/** The four launch tracks, in their declared order. */
const LAUNCH_TRACKS: readonly LaunchTrack[] = LaunchTrackSchema.options;

/**
 * Bumped whenever the scoring algorithm below changes, so a stored Match's
 * `scoringVersion` always says exactly which rules produced its score
 * (Prompt 7: "Deterministic, explainable baseline ... explicit weights").
 */
export const MATCHING_BASELINE_VERSION = 'v1';

/**
 * Only verified evidence can support a role requirement. There is no
 * partial credit, and that is the product, not a tuning choice.
 *
 * This used to be a weight table — verified 1, self_attested 0.7,
 * unverified 0.4 — on the reasoning that "an unverified claim is still real
 * signal for a human reviewer, just weaker". Two things were wrong with it.
 *
 * First, nothing in the codebase could ever set a state other than
 * `unverified` (evidence-claim-service deferred that to a verification flow
 * that did not exist), so in practice EVERY match score was a self-report
 * multiplied by 0.4. Zoryvex was selling proof and shipping resumes.
 *
 * Second, and worse: partial credit means an employer paying for verified
 * talent receives a ranked list in which unverified claims outrank verified
 * ones whenever they use more of the same keywords. A weaker weight does not
 * make an unchecked claim honest, it just prices it.
 *
 * Unverified evidence is not deleted or hidden from the candidate — it stays
 * on their profile as work in progress, with a route to verify it
 * (services/api/src/domain/verification-service.ts). It simply never
 * contributes to what an employer is shown or charged for.
 */
const VERIFICATION_WEIGHT: Record<Evidence['verificationState'], number> = {
  verified: 1,
  self_attested: 0,
  unverified: 0,
};

/**
 * The one gate every employer-facing path runs evidence through.
 *
 * Verification is a claim about a moment, not a permanent property. An AWS
 * certification lapses, and an item verified in 2026 against a credential
 * expiring in 2027 must stop counting as proof in 2027 without anybody
 * having to remember to re-run anything. Checked against the clock at read
 * time for exactly the same reason consent and visibility are: waiting for
 * the next recompute would leave an employer looking at a claim that is no
 * longer true.
 *
 * An absent expiry means the credential does not lapse (a repository, a
 * perpetual badge), which is different from "expiry unknown".
 */
export function isVerified(
  item: Pick<Evidence, 'verificationState' | 'verificationExpiresAt' | 'verificationMethod'>,
  now: Date,
): boolean {
  if (item.verificationState !== 'verified') return false;

  // A graded task is no longer proof of anything, including retrospectively.
  //
  // Nothing new can be verified this way (no claim type maps to it), but
  // items verified before that decision are still stored as `verified`, and
  // leaving them counting would have been the decision applied only to
  // people who had not got there yet. If a published brief marked against a
  // published rubric does not establish that a person can do the work, it
  // does not establish it for somebody who submitted last month either.
  //
  // The item is not deleted and not hidden from the candidate. It stops
  // supporting a match, stops appearing to an employer as proof, and stops
  // reaching the public proof page — the same three consequences an expired
  // certification has, and for the same reason: this is a claim about a
  // moment, and the moment did not hold.
  if (item.verificationMethod === 'graded_task') return false;
  if (!item.verificationExpiresAt) return true;

  // Shape-checked before parsing, because Date.parse is lenient enough to
  // salvage a year out of prose: "sometime in 2029" parses to a real date in
  // V8, which would have turned an unreadable expiry into a confident one.
  // Caught by its own test rather than in production.
  if (!/^\d{4}-\d{2}-\d{2}T/.test(item.verificationExpiresAt)) return false;

  const expiry = Date.parse(item.verificationExpiresAt);
  // An unreadable expiry fails closed. Showing a claim we cannot date is
  // worse than showing one fewer candidate.
  if (Number.isNaN(expiry)) return false;
  return expiry > now.getTime();
}

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'into',
  'your',
  'have',
  'been',
  'able',
  'will',
  'their',
  'they',
  'when',
  'while',
  'using',
  'used',
  'use',
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3 && !STOPWORDS.has(token)),
  );
}

function overlapFraction(requirementTokens: Set<string>, evidenceTokens: Set<string>): number {
  if (requirementTokens.size === 0) return 0;
  let matched = 0;
  for (const token of requirementTokens) {
    if (evidenceTokens.has(token)) matched += 1;
  }
  return matched / requirementTokens.size;
}

export interface ScoredEvidence {
  evidence: Pick<Evidence, 'id' | 'verificationState'>;
  tokens: Set<string>;
}

export interface RequirementScoringResult {
  matchScore: number;
  rationale: string;
  matchedEvidenceIds: string[];
}

/**
 * Pure, deterministic, explainable (Prompt 7's own three adjectives): the
 * same role+evidence always produce the same score and the same stated
 * reason, with no model call and no training on user data. `evidence`
 * should already be filtered to non-private items by the caller — this
 * function has no visibility rule of its own.
 *
 * Unverified evidence is dropped here rather than merely down-weighted, so
 * an unverified claim can never appear in a rationale an employer reads and
 * can never raise a match score. See VERIFICATION_WEIGHT above. `now` is
 * required rather than defaulted because a lapsed credential stops counting,
 * and a scorer that silently used the wall clock would be untestable at the
 * one boundary that matters.
 */
export function scoreCandidateAgainstRole(
  role: Role,
  evidence: Evidence[],
  now: Date,
): RequirementScoringResult {
  const scoredEvidence = evidence
    .filter((item) => isVerified(item, now))
    .map((item) => ({
      evidence: item,
      tokens: tokenize(`${item.claim} ${item.context} ${item.actions} ${item.outcome}`),
    }));

  const matchedEvidenceIds = new Set<string>();
  const lines: string[] = [];
  let totalScore = 0;

  for (const requirement of role.mustHaveWork) {
    const requirementTokens = tokenize(requirement);

    let best: {
      id: string;
      verificationState: Evidence['verificationState'];
      coverage: number;
    } | null = null;
    for (const candidate of scoredEvidence) {
      const coverage = overlapFraction(requirementTokens, candidate.tokens);
      if (coverage <= 0) continue;
      if (!best || coverage > best.coverage) {
        best = {
          id: candidate.evidence.id,
          verificationState: candidate.evidence.verificationState,
          coverage,
        };
      }
    }

    // The capability path is gone with graded tasks. It credited a
    // requirement in full when a task the candidate passed tested the
    // matching capability, which was the strongest support the platform had
    // while that check meant something. It cannot survive the check being
    // retired: telling an employer a requirement is "supported by a graded
    // task this candidate passed" would be selling them a result the
    // platform no longer stands behind.
    const wordingScore = best
      ? Math.min(1, best.coverage * VERIFICATION_WEIGHT[best.verificationState])
      : 0;

    if (!best) {
      lines.push(`"${requirement}": no verified evidence supports this.`);
      continue;
    }

    totalScore += wordingScore;
    matchedEvidenceIds.add(best.id);
    lines.push(
      `"${requirement}": supported by verified evidence ${best.id} ` +
        `(${Math.round(best.coverage * 100)}% keyword overlap).`,
    );
  }

  const matchScore = role.mustHaveWork.length > 0 ? totalScore / role.mustHaveWork.length : 0;

  return {
    matchScore,
    rationale: lines.join(' '),
    matchedEvidenceIds: [...matchedEvidenceIds],
  };
}

export interface MatchingDependencies {
  clock: Clock;
  getRole(roleId: string): Promise<{ role: Role; version: number } | null>;
  listDiscoveryOptedCandidates(launchTrack: LaunchTrack): Promise<Candidate[]>;
  listCandidateEvidence(candidateId: string): Promise<Evidence[]>;
  getMatch(roleId: string, candidateId: string): Promise<Match | null>;
  putMatch(match: Match): Promise<Match>;
  listMatchesForRole(roleId: string): Promise<Match[]>;
  deleteMatch(roleId: string, candidateId: string): Promise<void>;
  getFeatureFlags(): Promise<FeatureFlags>;
  generateId(): string;
}

/**
 * The `aiMatching` kill switch applied at the read boundary.
 *
 * docs/AI_SAFETY.md "Rollback" promises that turning AI off is nothing more
 * than setting the flag to `false`, and MatchSchema's own comment claims
 * `aiExplanation` is "always absent while aiMatching is off". Neither was
 * true: only handlers/matches/explain.ts ever consulted the flag, so every
 * explanation generated while it was on kept being served by
 * `GET /roles/{roleId}/matches` (and by recompute's own response) forever
 * after — including after scripts/emergency-cost-lockdown.mjs forced the
 * flag off during an incident. Found in a 2026-08-27 audit.
 *
 * Deliberately a redaction of the response, not a delete of the stored
 * value: AI_SAFETY.md's "no data migration is required" only holds if
 * turning the flag back on restores what was there, and the deterministic
 * `rationale`/`matchedEvidenceIds` beside it are untouched either way.
 */
export function redactAiOutput(matches: Match[], flags: FeatureFlags): Match[] {
  if (flags.aiMatching) return matches;
  return matches.map(({ aiExplanation: _dropped, ...rest }) => rest);
}

/**
 * Drops the candidate-addressed explanation before a match leaves for an
 * employer.
 *
 * `fitReasonForCandidate` exists so the candidate is not described to
 * themselves in the third person, and it names the minimum they entered:
 * "you said you need at least NGN 900,000". The employer's own
 * `fitReason` deliberately says only that the role pays below what they
 * need, because the profile field that collects the figure promises it is
 * never shown to an employer as a demand.
 *
 * Withholding it from the screen is not enough. The shortlist endpoint
 * serializes the whole Match, so leaving the field on the object would
 * put the figure in the response body of a page the employer already has
 * open — invisible, and one devtools panel or one future component away
 * from being visible. It is removed here, at the boundary, so no caller
 * has to remember.
 */
export function forEmployerEyes(matches: Match[]): Match[] {
  return matches.map(({ fitReasonForCandidate: _theirs, ...rest }) => rest);
}

/**
 * An AI explanation is only meaningful about the exact evidence set it was
 * written from — it names evidence IDs inline in its prose, and
 * docs/AI_SAFETY.md requires AI output to stay grounded in cited evidence.
 * Recompute refreshes `matchedEvidenceIds` but used to carry
 * `aiExplanation` across verbatim, so once a candidate edited, hid, or
 * deleted an evidence item (evidence-claim-service.ts's single-item delete
 * never touches a Match), the surviving explanation described evidence the
 * match no longer contains. Comparing as a set, not a sequence: order is an
 * artifact of scoring, not a change in what was matched.
 */
function sameEvidenceSet(a: string[] | undefined, b: string[] | undefined): boolean {
  const left = new Set(a ?? []);
  const right = new Set(b ?? []);
  if (left.size !== right.size) return false;
  for (const id of left) if (!right.has(id)) return false;
  return true;
}

/**
 * Recomputes and stores a fresh deterministic score for every candidate
 * currently opted into discovery for this role's launch track. Existing
 * human-set state (`status`, `contactUnlocked`, `id`, `createdAt`) is
 * preserved across recompute — only the system-generated
 * score/rationale/citations/version are refreshed, so an employer's review
 * progress or an unlocked contact is never silently reset by a later
 * recompute. A candidate who has since opted out of discovery is simply
 * skipped (no new/updated score), but any Match already on record for them
 * is left alone rather than deleted — same retention posture as
 * KitOrder/AuditEvent (docs/DATA_MODEL.md).
 *
 * A prior `aiExplanation` is preserved only while the matched evidence set
 * is unchanged (see sameEvidenceSet above); otherwise it is dropped rather
 * than left describing evidence that is no longer part of this match.
 */
/**
 * What a recompute did, rather than only what survived it.
 *
 * `locationExcluded` counts candidates who back at least one requirement but
 * sit outside the role's location. They are no longer removed — they appear
 * as `partial`, saying so — but the count is still reported, because an
 * employer deciding whether to relax a location requirement wants the number
 * without reading the whole list.
 *
 * `beyondRequirements` counts candidates carrying verified proof that backs
 * none of the stated requirements. They appear as `adjacent`. The count
 * exists for the same reason: a requirement list is a guess at what the work
 * needs, and knowing how many proved people it is talking past is the
 * information that lets an employer reconsider the guess.
 */
export interface RecomputeResult {
  matches: Match[];
  locationExcluded: number;
  beyondRequirements: number;
}

/**
 * What keeps a candidate from being an exact answer to the role as written.
 *
 * Collected rather than returned at the first hit, so the sentence an
 * employer reads can state every reason at once. Somebody proved in a
 * different track AND in another city should not be told about the city and
 * left to discover the track later.
 */
function fitReasonsFor(input: {
  offTrack: boolean;
  outsideLocation: boolean;
  locationExplanation: string;
  backsNoRequirement: boolean;
  roleTrack: LaunchTrack;
  candidateTrack: LaunchTrack;
  payShortfall: { forEmployer: string; forCandidate: string } | null;
  engagementMismatch: { forEmployer: string; forCandidate: string } | null;
  /**
   * Who the sentences are for. The employer's shortlist and the
   * candidate's list of roles render the same comparison, and an
   * explanation written for one reads wrongly to the other: the candidate
   * was being told about themselves in the third person, and the
   * employer's copy quoted a figure the candidate was promised would stay
   * theirs.
   */
  audience: 'employer' | 'candidate';
}): string[] {
  const forCandidate = input.audience === 'candidate';
  const reasons: string[] = [];
  if (input.backsNoRequirement) {
    reasons.push(
      forCandidate
        ? "None of this role's must-haves are directly backed by your proof. What you have " +
            'verified is real and checked, it just answers a different question than the one ' +
            'this role asks.'
        : "None of this role's must-haves are directly backed by their proof. What they have " +
            'verified is real and checked, it just answers a different question than the one ' +
            'this role asks.',
    );
  }
  if (input.offTrack) {
    reasons.push(
      forCandidate
        ? `This role is in ${LAUNCH_TRACK_LABELS[input.roleTrack]} rather than ` +
            `${LAUNCH_TRACK_LABELS[input.candidateTrack]}. Neighbouring work, proved the same way.`
        : `They work in ${LAUNCH_TRACK_LABELS[input.candidateTrack]} rather than ` +
            `${LAUNCH_TRACK_LABELS[input.roleTrack]}. Neighbouring work, proved the same way.`,
    );
  }
  if (input.outsideLocation) {
    reasons.push(`Outside this role's location requirement: ${input.locationExplanation}`);
  }
  // Pay and engagement kind are stated as reasons rather than used as
  // filters, for the same reason location is: an employer may well want to
  // talk to somebody slightly outside what they wrote down, and the useful
  // thing is to say so before they spend an unlock finding out. A candidate
  // who never gets shown cannot negotiate.
  if (input.payShortfall) {
    reasons.push(forCandidate ? input.payShortfall.forCandidate : input.payShortfall.forEmployer);
  }
  if (input.engagementMismatch) {
    reasons.push(
      forCandidate ? input.engagementMismatch.forCandidate : input.engagementMismatch.forEmployer,
    );
  }
  return reasons;
}

export async function recomputeMatchesForRole(
  employerId: string,
  roleId: string,
  deps: MatchingDependencies,
): Promise<RecomputeResult> {
  const result = await deps.getRole(roleId);
  if (!result || result.role.employerId !== employerId) throw new NotFoundError('Role not found');
  const { role } = result;

  // Every track, not only the role's own.
  //
  // A launch track is how a candidate describes the work they want, not a
  // statement about what their proof establishes. Somebody who verified
  // least-privilege IAM under cloud-security has proved the same thing a
  // DevOps role is asking about, and reading them out of the list because of
  // a label they picked at sign-up loses a real, checked match for no reason
  // an employer would agree with. They arrive as `partial`, saying which
  // track they came from, so the difference is visible rather than silently
  // dissolved.
  //
  // The role's own track is queried first so its candidates are scored and
  // stored before the neighbours, keeping recompute order stable.
  const tracks: LaunchTrack[] = [
    role.launchTrack,
    ...LAUNCH_TRACKS.filter((track) => track !== role.launchTrack),
  ];
  // Deduplicated by id, keeping the first occurrence so the role's own track
  // wins. A candidate is indexed under exactly one track, so this should
  // never fire in production — but scoring somebody twice would write two
  // matches for one person, and a guard that costs a Map is cheaper than
  // trusting that invariant from four separate queries.
  const byId = new Map<string, Candidate>();
  for (const candidate of (
    await Promise.all(tracks.map((track) => deps.listDiscoveryOptedCandidates(track)))
  ).flat()) {
    if (!byId.has(candidate.id)) byId.set(candidate.id, candidate);
  }
  const candidates = [...byId.values()];
  const now = deps.clock.now().toISOString();

  const matches: Match[] = [];
  let locationExcluded = 0;
  let beyondRequirements = 0;
  for (const candidate of candidates) {
    // An employer who pays to reach somebody must be able to reach them.
    // A contact unlock spends one of a metered monthly allowance, and an
    // email address alone is the channel a stranger's message is most
    // likely to die in. Founder decision, 2026-09-14: a phone number and
    // one way to see their work are what make a candidate findable.
    //
    // Skipped here rather than refused at save time, so a candidate who
    // signed up before the rule keeps their profile, their claims and
    // their proofs. They are simply not shown until an employer could act
    // on the result, and their own profile tells them exactly what is
    // missing.
    if (!isContactableForDiscovery(candidate)) continue;

    const evidence = (await deps.listCandidateEvidence(candidate.id)).filter(
      (item) => item.visibility !== 'private',
    );
    const scoring = scoreCandidateAgainstRole(role, evidence, deps.clock.now());
    const existing = await deps.getMatch(roleId, candidate.id);

    // No verified evidence supporting any requirement means no match at all,
    // not a match scored zero. An employer paying for verified talent is
    // buying a shortlist, and padding it with candidates the platform cannot
    // vouch for is the exact thing that makes a marketplace worthless.
    //
    // The one gate that still removes somebody: no verified evidence at all.
    //
    // This is the product rather than a filter. An employer paying for
    // verified talent is buying a shortlist, and padding it with people the
    // platform cannot vouch for is the exact thing that makes a marketplace
    // worthless. It is also the path that reacts to a credential EXPIRING —
    // yesterday's proof stops counting the moment the issuer says it lapsed,
    // and the list has to follow.
    //
    // What is NO LONGER a reason to remove somebody: backing none of the
    // stated requirements, working in a neighbouring track, or living outside
    // the location. Each of those used to delete a candidate outright, and
    // between them they routinely emptied a search while leaving the employer
    // unable to tell "nobody qualified" from "your filters removed everyone".
    // Those three are now tiers with a stated reason, further down.
    //
    // The one case written anyway is a match whose contact the employer
    // already paid to unlock. That row is their record of a purchase and is
    // never deleted — it is refreshed instead, so it states the truth rather
    // than a stale score implying support that has since gone.
    const verifiedEvidence = evidence.filter((item) => isVerified(item, deps.clock.now()));
    if (verifiedEvidence.length === 0) {
      if (!existing) continue;
      if (!existing.contactUnlocked) {
        await deps.deleteMatch(roleId, candidate.id);
        continue;
      }
    }

    const locationFit = evaluateLocationFit(role.locationRequirement, candidate.location);
    const offTrack = candidate.launchTrack !== role.launchTrack;
    const backsNoRequirement = scoring.matchedEvidenceIds.length === 0;

    if (!locationFit.fits && !backsNoRequirement) locationExcluded += 1;
    if (backsNoRequirement) beyondRequirements += 1;

    // What the role pays against what this candidate said they need.
    // Silence on either side is not a shortfall: most roles publish no
    // range and most candidates have stated no minimum, so treating
    // unknown as a failure would empty every shortlist.
    const pay = compensationClears(
      role.intent?.compensation,
      candidate.intent?.minimumCompensation,
    );
    const payShortfall = pay.clears
      ? null
      : { forEmployer: pay.reasonForEmployer, forCandidate: pay.reasonForCandidate };

    // Whether this is the kind of arrangement they are open to. Only
    // checked when the candidate has actually listed what they want: an
    // empty list means no preference, not "nothing".
    const openTo = candidate.intent?.openTo ?? [];
    const wantedKind = role.intent?.engagementKind ?? 'employment';
    const engagementMismatch =
      openTo.length > 0 && !openTo.includes(wantedKind)
        ? {
            forEmployer:
              `This is ${ENGAGEMENT_KIND_PHRASES[wantedKind]}, which is not among ` +
              'the kinds of work they said they are open to.',
            forCandidate:
              `This is ${ENGAGEMENT_KIND_PHRASES[wantedKind]}, which is not among ` +
              'the kinds of work you said you are open to.',
          }
        : null;

    // Both are built here, from one set of facts, so the two sides can
    // never be told different things about the same match.
    const reasonInput = {
      offTrack,
      outsideLocation: !locationFit.fits,
      locationExplanation: locationFit.fits ? '' : locationFit.explanation,
      backsNoRequirement,
      roleTrack: role.launchTrack,
      candidateTrack: candidate.launchTrack,
      payShortfall,
      engagementMismatch,
    } as const;
    const reasons = fitReasonsFor({ ...reasonInput, audience: 'employer' });
    const candidateReasons = fitReasonsFor({ ...reasonInput, audience: 'candidate' });

    const fit: MatchFit =
      reasons.length === 0 ? 'meets' : backsNoRequirement ? 'adjacent' : 'partial';

    // Which evidence the employer is pointed at.
    //
    // For a match that backs a requirement this stays exactly what it was:
    // the items that did the backing, and nothing else. For an `adjacent`
    // match there is no such set, and showing an employer a candidate with
    // no evidence attached would be worse than not showing them at all — the
    // card would assert somebody is worth a look and offer nothing to check.
    // So their verified evidence is cited instead, which is precisely the
    // thing the tier is claiming they have. matchScore stays 0 throughout,
    // so nothing here inflates how well they answer the role.
    const citedEvidence = backsNoRequirement
      ? verifiedEvidence
      : evidence.filter((item) => scoring.matchedEvidenceIds.includes(item.id));
    const citedIds = backsNoRequirement
      ? citedEvidence.map((item) => item.id)
      : scoring.matchedEvidenceIds;
    const strongest = strongestAcross(citedEvidence, deps.clock.now());

    const match: Match = {
      id: existing?.id ?? deps.generateId(),
      roleId,
      candidateId: candidate.id,
      matchScore: scoring.matchScore,
      status: existing?.status ?? 'suggested',
      contactUnlocked: existing?.contactUnlocked ?? false,
      rationale: scoring.rationale,
      fit,
      ...(reasons.length > 0 ? { fitReason: reasons.join(' ') } : {}),
      ...(candidateReasons.length > 0 ? { fitReasonForCandidate: candidateReasons.join(' ') } : {}),
      // Written from the same `openTo` the mismatch reason above was built
      // from, in the same pass, so the shortlist can never show a preference
      // that disagrees with the explanation beside it. Always set, including
      // when the candidate listed nothing: an empty list is their answer,
      // and only an absent field means this row predates the feature.
      candidateOpenTo: openTo,
      matchedEvidenceIds: citedIds,
      scoringVersion: MATCHING_BASELINE_VERSION,
      ...(strongest ? { strongestEvidence: strongest } : {}),
      aiExplanation: sameEvidenceSet(existing?.matchedEvidenceIds, citedIds)
        ? existing?.aiExplanation
        : undefined,
      createdAt: existing?.createdAt ?? now,
    };
    matches.push(await deps.putMatch(match));
  }
  return {
    matches: redactAiOutput(matches, await deps.getFeatureFlags()),
    locationExcluded,
    beyondRequirements,
  };
}

/** Ownership-checked read — never confirms/denies another employer's role exists. */
export async function getMatchesForRole(
  employerId: string,
  roleId: string,
  deps: Pick<MatchingDependencies, 'getRole' | 'listMatchesForRole' | 'getFeatureFlags'>,
): Promise<Match[]> {
  const result = await deps.getRole(roleId);
  if (!result || result.role.employerId !== employerId) throw new NotFoundError('Role not found');
  const matches = await deps.listMatchesForRole(roleId);
  return forEmployerEyes(redactAiOutput(byStrongestMatch(matches), await deps.getFeatureFlags()));
}

/**
 * Strongest first, then by candidate id so equal scores never shuffle between
 * two loads of the same page.
 *
 * The repository returns matches in DynamoDB's sort-key order, which is by
 * candidate id and has nothing to do with how well anybody matched. Reading
 * the demo store directly returned 0.75, 0.80, 0.60, 0.70, 0.65 in that
 * order, and a list has no way of saying "this order means nothing": a reader
 * takes the top of a list as the place to start. With five candidates that
 * wastes their time. With fifty it hides the best one.
 *
 * Found by watching the product rather than by reading it, in a screenshot of
 * the matches page.
 *
 * This orders the list; it does not claim the top one is the better hire. The
 * card copy still says the ranking is a suggestion and not a judgment of
 * merit, and the evidence panel underneath is what an employer is meant to
 * decide on.
 */
/**
 * Where a level sits in the hierarchy. Absent evidence sorts below everything,
 * which is what a match written before ranking considered strength should do.
 */

/**
 * How well a match answers what the role actually asked for.
 *
 * A match written before tiering existed has no `fit`, and is read as
 * `meets` everywhere else in this file, so it is read as `meets` here too.
 * A stored shortlist must not reorder itself under an employer because a
 * field was added later.
 */

/**
 * Fit first, then coverage, then the strength of the evidence behind it, then
 * candidate id so equal matches hold their place between loads.
 *
 * Fit leads because it answers a different question from the other three, and
 * a blunter one: whether this person can be hired into this role at all. A
 * role states the countries it can employ in and how far from its working
 * hours it can stretch. A candidate outside either is still shown — this
 * product does not hide people, and the card says in a sentence what does not
 * line up — but showing them above somebody the employer could actually hire
 * inverts what the employer said they needed. Ranking on coverage alone did
 * exactly that: a candidate in the wrong country with broader proof sat above
 * a hireable one with narrower proof.
 *
 * Below fit, the order is unchanged and lexicographic on purpose rather than
 * blended. matchScore keeps meaning exactly one thing — the proportion of a
 * role's must-have requirements backed by verified proof — and strength is a
 * second axis an employer can read separately. Multiplying them together
 * would produce a number nobody could explain, which is the opaque scoring
 * this product argues against.
 *
 * Two consequences, both stated because they are the point. Candidates whose
 * proof covers the same requirements are separated by how rigorously that
 * proof was checked, and the employer can see which level did it. And nothing
 * here is a filter: every match still reaches the employer, in an order that
 * matches what they asked for.
 */
