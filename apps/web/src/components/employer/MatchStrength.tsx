import { Badge } from '@/components/ui/Badge';

/**
 * What a match score actually is, said out loud.
 *
 * It was rendered everywhere as "72% match", which is the vaguest possible
 * reading of a number that means something exact.
 * `scoreCandidateAgainstRole` walks the role's must-have work, finds the
 * single best piece of verified evidence for each requirement, weights it
 * by keyword coverage, and divides by the number of requirements. So the
 * number is the share of what the employer said they needed that verified
 * proof actually supports.
 *
 * "72% match" invites the reader to imagine a similarity engine that does
 * not exist here. Naming the real quantity is both more useful and more
 * defensible, and it is the difference between a score somebody trusts and
 * a score somebody argues with.
 */

export interface MatchStrengthProps {
  /** 0 to 1, as stored on the Match. */
  score: number;
  /** How many requirements the role actually lists, when the caller knows. */
  requirementCount?: number | undefined;
  /** Live, non-private proofs behind this match. */
  proofCount?: number | undefined;
}

/** The whole sentence, for anywhere that needs it as one string. */
export function matchStrengthSentence(score: number, requirementCount?: number): string {
  const percent = Math.round(score * 100);
  if (percent === 0) return 'No verified proof supports this role yet';
  return requirementCount
    ? `${percent}% of your ${requirementCount} must-have requirement${requirementCount === 1 ? '' : 's'} backed by proof`
    : `${percent}% of your must-have work backed by proof`;
}

/** The same fact minus the leading percentage, for use beside the badge. */
function qualifier(percent: number, requirementCount?: number): string {
  if (percent === 0) return 'no proof supports this yet';
  return requirementCount
    ? `of your ${requirementCount} must-have requirement${requirementCount === 1 ? '' : 's'} backed by proof`
    : 'of your must-have work backed by proof';
}

export function MatchStrength({ score, requirementCount, proofCount }: MatchStrengthProps) {
  const percent = Math.round(score * 100);

  return (
    <div className="flex flex-col items-end gap-1 text-right">
      {/*
        Accent at half or better. Not a quality judgement about the person:
        it is the point past which more of the employer's own stated
        requirements are backed by proof than are not.
      */}
      <Badge tone={percent >= 50 ? 'accent' : 'neutral'}>
        <span className="tabular-nums">{percent}%</span>
      </Badge>
      <span className="text-xs text-ink-700">{qualifier(percent, requirementCount)}</span>
      {proofCount !== undefined && (
        <span className="text-xs text-ink-700">
          {proofCount === 0
            ? 'no current proofs'
            : `${proofCount} current proof${proofCount === 1 ? '' : 's'}`}
        </span>
      )}
    </div>
  );
}
