import {
  EVIDENCE_STRENGTH_LEVELS,
  SUPPORTED_STRENGTH_LEVELS,
  type Evidence,
  type EvidenceStrength,
  type EvidenceStrengthLevel,
} from '@zoryvex/contracts';
import { isVerified } from './matching-service';

/**
 * What a piece of evidence actually establishes, derived from what was done
 * to it rather than asserted about it.
 *
 * Every level below is earned by a fact already recorded on the evidence: the
 * method that verified it, whether an issuer was involved, whether a machine
 * examined a resulting state, whether the credential lapses. Nothing here
 * takes a candidate's word for anything, and nothing takes ours either — an
 * employer reading a level can be told exactly which fact produced it.
 *
 * The mapping is deliberately conservative, because overclaiming here is the
 * enemy this product is named against. A certification confirmed with its
 * issuer means somebody else assessed their KNOWLEDGE. It does not mean their
 * work was corroborated, and calling it that would be a lie that flattered
 * everybody involved. A passed work sample demonstrates skill and verifies an
 * outcome, because a machine read the configuration and checked what it does.
 * It does not observe process, because the grader sees a submission and not
 * the road to it.
 */

interface Reason {
  level: EvidenceStrengthLevel;
  basis: string;
}

export interface StrengthContext {
  /**
   * Whether somebody at the organisation the work was done at confirmed this
   * claim, from an address they proved they control.
   *
   * Passed in rather than read here so this function stays pure and the
   * caller decides how much work to do: the public page and the employer
   * view both already load what they need, and a strength function that
   * fetched would make every call a database read.
   */
  peerAttested?: boolean;
}

export function evidenceStrength(
  item: Evidence,
  now: Date,
  context: StrengthContext = {},
): EvidenceStrength {
  const reasons: Reason[] = [
    // Everything is at least this, including things that are nothing else.
    // Naming it rather than leaving the list empty is what makes an
    // unverified claim legible as an unverified claim.
    {
      level: 'claimed',
      basis:
        item.verificationMethod === 'graded_task'
          ? // Retired on 2026-09-06, and said plainly rather than left as a
            // silent downgrade. This item was marked against a published
            // rubric, and the rubric turned out to be solvable from the brief
            // by a language model, so the mark says nothing about the person.
            // isVerified refuses the method outright, so this never sits
            // alongside a higher level; it exists so a candidate reading their
            // own profile is told what happened instead of watching a level
            // disappear.
            'This was marked against a practical task. Zoryvex stopped treating those as proof, ' +
            'because the answer could be produced from the published brief without doing the work.'
          : 'The candidate filed this claim themselves.',
    },
  ];

  // Verification is re-checked against the clock rather than read from
  // storage, on the same isVerified the marketplace and the public page use.
  // A lapsed credential must not go on advertising a strength it lost.
  if (isVerified(item, now)) {
    const detail = item.verificationDetail ?? 'A check was recorded.';

    if (item.verificationMethod === 'issuer_badge') {
      reasons.push({
        level: 'knowledge_assessed',
        basis: `Confirmed with the body that issued it. ${detail}`,
      });
    }

    if (item.verificationMethod === 'repo_ownership') {
      reasons.push({
        level: 'work_corroborated',
        basis: `Found in a source the candidate does not control, and attributed to them. ${detail}`,
      });
    }

    // Attributable testimony, and only that. It sits just above a bare claim
    // in the hierarchy for a reason: a colleague can be mistaken, or a
    // friend, and no amount of sincerity turns that into a check.
    if (context.peerAttested) {
      reasons.push({
        level: 'peer_verified',
        basis:
          'Confirmed by somebody at the organisation the work was done at, writing from an address they proved they control. That is testimony rather than a check, and is worth what testimony is worth.',
      });
    }

    // Only where a lapse is actually enforced. A credential with no expiry is
    // verified once and then trusted, which is a weaker thing than a check
    // that expires and is honestly a different level.
    if (item.verificationExpiresAt) {
      reasons.push({
        level: 'continuously_verified',
        basis: `Stops counting on ${item.verificationExpiresAt.slice(0, 10)} without anyone having to remember, and is re-checked against the clock on every read.`,
      });
    }
  }

  // Ordered by the hierarchy rather than by the order they were added, so two
  // pieces of evidence are always presented the same way round.
  const attained = EVIDENCE_STRENGTH_LEVELS.filter((level) =>
    reasons.some((r) => r.level === level),
  );

  const basis: Record<string, string> = {};
  for (const level of attained) {
    basis[level] = reasons.find((r) => r.level === level)!.basis;
  }

  return {
    attained,
    basis,
    // Stated on every response rather than only when relevant. An employer
    // who cannot tell "this candidate did not do that" from "Zoryvex does not
    // do that yet" is being misled by omission.
    unsupported: EVIDENCE_STRENGTH_LEVELS.filter(
      (level) => !SUPPORTED_STRENGTH_LEVELS.includes(level),
    ),
  };
}

/**
 * The strongest thing this evidence establishes, for a headline.
 *
 * Never a score and never a total: "outcome verified" is one fact, not four
 * points. Returning the highest attained level rather than a count keeps the
 * headline something an employer can check rather than compare.
 */
export function strongestLevel(strength: EvidenceStrength): EvidenceStrengthLevel {
  const attained = strength.attained;
  return attained[attained.length - 1] ?? 'claimed';
}

/**
 * The strongest level anything in a set establishes, or null for an empty set.
 *
 * Used to rank matches that cover the same proportion of a role's
 * requirements. Deliberately the strongest single item rather than a sum:
 * "what is the best evidence behind this?" is a question with an answer an
 * employer can check, and a total would reward filing more claims rather than
 * stronger ones.
 */
export function strongestAcross(
  items: Evidence[],
  now: Date,
  peerAttestedEvidenceIds: ReadonlySet<string> = new Set(),
): EvidenceStrengthLevel | null {
  let best: EvidenceStrengthLevel | null = null;
  let bestIndex = -1;
  for (const item of items) {
    const level = strongestLevel(
      evidenceStrength(item, now, { peerAttested: peerAttestedEvidenceIds.has(item.id) }),
    );
    const index = EVIDENCE_STRENGTH_LEVELS.indexOf(level);
    if (index > bestIndex) {
      bestIndex = index;
      best = level;
    }
  }
  return best;
}
