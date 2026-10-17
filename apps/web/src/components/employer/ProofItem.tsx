import Link from 'next/link';
import { EVIDENCE_STRENGTH_DEFINITIONS } from '@zoryvex/contracts';
import type { VerifiedEvidenceSummary } from '@/lib/real-api/matches';

/**
 * One verified claim, as the employer who paid for the proof reads it.
 *
 * Lifted out of the role page so it can be tested. What this renders is the
 * whole argument of the product on one screen: not that a candidate is
 * "verified", but what was checked, by whom, when, what that establishes,
 * what it does not, and where to go and check it without Zoryvex in the
 * middle. Every one of those is a separate block below, and none of them is
 * a score.
 */
export function ProofItem({ item }: { item: VerifiedEvidenceSummary }) {
  return (
    <li>
      <p className="break-words font-medium text-ink-950">{item.claim}</p>
      <p className="mt-1 break-words text-sm text-ink-700">
        {item.context} {item.actions} {item.outcome}
      </p>
      <p className="mt-1 break-words text-sm text-accent-700">
        {METHOD_LABEL[item.method]} · {item.detail}
      </p>
      <p className="mt-0.5 text-xs text-ink-700">
        Checked {new Date(item.verifiedAt).toLocaleDateString()}
      </p>
      {/*
        What the check establishes, rather than only that one
        happened. This is the screen somebody pays to read, and
        "verified" alone leaves them to guess whether a credential
        somebody else issued and work found in a source the
        candidate does not control are the same thing. They are not.
      */}
      <ul className="mt-2 flex flex-col gap-0.5 text-xs text-ink-700">
        {item.strength.attained.map((level) => (
          <li key={level}>
            <span className="font-medium text-ink-950">
              {EVIDENCE_STRENGTH_DEFINITIONS[level].name}
            </span>{' '}
            · {item.strength.basis[level]}
          </li>
        ))}
      </ul>
      {item.strength.unsupported.length > 0 && (
        <p className="mt-1 text-xs text-ink-700">
          Not established by Zoryvex for anyone:{' '}
          {item.strength.unsupported
            .map((level) => EVIDENCE_STRENGTH_DEFINITIONS[level].name.toLowerCase())
            .join(', ')}
          . That is a limit of what we check, not a finding about this candidate.
        </p>
      )}
      {/*
        The sequence behind a graded task, not a score. A candidate
        who passed first time and one who wrote a wildcard
        permission, was told, and fixed it showed the same green
        tick here until now. Presented as facts and left to the
        employer to weigh: three attempts is not worse than one, and
        a product that framed it that way would be teaching people
        to submit once and guess.
      */}
      {item.attempts && item.attemptSummary && (
        <div className="mt-2 border-l-2 border-ink-200 pl-3">
          <p className="text-xs text-ink-700">{item.attemptSummary}</p>
          {item.attempts.attempts.length > 1 && (
            <ul className="mt-1 flex flex-col gap-0.5 text-xs text-ink-700">
              {item.attempts.attempts.map((a) => (
                <li key={a.attemptNumber}>
                  <span className="font-medium text-ink-950">Attempt {a.attemptNumber}</span> ·{' '}
                  {a.passed
                    ? 'passed'
                    : a.failedCheckIds.length > 0
                      ? `outstanding: ${a.failedCheckIds.join(', ')}`
                      : 'did not pass'}
                  {a.disqualified ? ' · tripped a disqualifying check' : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {/*
        The address of the independent record is the paid artifact. It is
        the thing that lets an employer confirm the candidate without
        Zoryvex, so the server releases it only to an organization whose
        subscription currently grants marketplace access, and withholds the
        value itself rather than leaving the page to hide it. A URL present
        in the response is public whatever the markup does with it.

        An employer without access still sees that the record exists and
        what kind it is, because that is a fact about the evidence and
        hiding it would misrepresent how well the claim was checked.
      */}
      {item.sourceUrl ? (
        <p className="mt-1 text-sm">
          <a
            href={item.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block py-2 text-accent-700 underline"
          >
            Check this yourself at the source
          </a>
        </p>
      ) : (
        item.sourceAvailable && (
          <p className="mt-1 text-sm text-ink-700">
            {SOURCE_HOLDER[item.method]} holds a public record of this check, so you can confirm it
            without taking our word for it. A marketplace subscription opens it.{' '}
            <Link prefetch={false} href="/employer/billing" className="text-accent-700 underline">
              See the plans
            </Link>
            .
          </p>
        )
      )}
    </li>
  );
}

/**
 * Who the independent record belongs to, for the employer who cannot open it
 * yet. Naming the holder says how strong the check is without handing over
 * the address: "the issuer" and "GitHub" are different kinds of confirmation
 * and a reader deciding whether to subscribe deserves to know which one is
 * waiting.
 */
const SOURCE_HOLDER: Record<VerifiedEvidenceSummary['method'], string> = {
  issuer_badge: 'The issuer',
  repo_ownership: 'GitHub',
  // No third party exists for a graded task, so sourceAvailable is false and
  // this is never rendered. Present because the record is exhaustive.
  graded_task: 'Zoryvex',
};

const METHOD_LABEL: Record<VerifiedEvidenceSummary['method'], string> = {
  issuer_badge: 'Confirmed with the issuer',
  repo_ownership: 'Confirmed on GitHub',
  graded_task: 'Scored on a practical task',
};
