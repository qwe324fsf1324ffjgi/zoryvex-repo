'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatCompensationRange, type InterestState } from '@zoryvex/contracts';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StatusState } from '@/components/ui/StatusState';
import { PageHeader, Section } from '@/components/layout/Section';
import { PageLoading } from '@/components/ui/PageLoading';
import { useSession } from '@/lib/use-session';
import {
  isRealApiConfigured,
  messageFor,
  realCandidateMatches,
  type CandidateMatchView,
} from '@/lib/real-api';

/**
 * The roles a candidate has been matched to, and their answer to each.
 *
 * This screen did not exist. Matching wrote rows keyed by candidate that
 * no candidate could read, so "mutual matching" described something the
 * product could not do: one side had no way to answer.
 *
 * Everything shown here comes from `GET /candidates/me/matches`, which
 * narrows server-side. Nothing about other candidates reaches the
 * browser, so there is nothing here to accidentally render.
 */
export default function CandidateMatchesPage() {
  const session = useSession();
  const useReal = isRealApiConfigured();
  const [matches, setMatches] = useState<CandidateMatchView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!session?.candidateId) return;
    setLoadError(null);
    realCandidateMatches
      .listMyMatches()
      .then(setMatches)
      .catch((error: unknown) => {
        // A failed load is not an empty list. Showing "no matches yet"
        // when the request failed would tell somebody their work found
        // nobody, which is a different and much worse message.
        setMatches(null);
        setLoadError(messageFor(error, 'Something went wrong loading your matches. Try again.'));
      });
  }, [session]);

  useEffect(() => {
    if (useReal) load();
  }, [useReal, load]);

  async function answer(roleId: string, interest: InterestState) {
    setSavingRoleId(roleId);
    setActionError(null);
    try {
      await realCandidateMatches.setMyInterest(roleId, interest);
      // Re-read rather than patching local state: whether this made the
      // match mutual depends on the employer's answer, which only the
      // server knows.
      await realCandidateMatches.listMyMatches().then(setMatches);
    } catch (error: unknown) {
      setActionError(messageFor(error, 'Something went wrong saving that. Try again.'));
    } finally {
      setSavingRoleId(null);
    }
  }

  if (!useReal) {
    return (
      <Section>
        <PageHeader title="Roles matched to you" />
        <StatusState
          kind="empty"
          title="Not available in this build"
          body="Matched roles come from the live service. This build has no backend configured."
        />
      </Section>
    );
  }

  if (!session) return <PageLoading label="Loading your matches" />;

  return (
    <Section>
      <PageHeader
        title="Roles matched to you"
        intro="Employers who are looking for what you have proved. Saying yes tells them you are open to a conversation; it does not share your contact details. We email you when an employer is interested, and it stays on this page either way, so nothing is lost if you miss the mail."
      />

      {actionError && (
        <div role="alert" className="mb-4">
          <StatusState kind="500" title="That did not save" body={actionError} />
        </div>
      )}

      {loadError ? (
        <StatusState
          kind="500"
          title="Could not load your matches"
          body={loadError}
          action={
            <Button variant="secondary" onClick={load}>
              Try again
            </Button>
          }
        />
      ) : matches === null ? (
        <PageLoading label="Loading your matches" />
      ) : matches.length === 0 ? (
        <StatusState
          kind="empty"
          title="No roles yet"
          body="Matching runs in the background against what you have verified. Adding another proof, or opting into discovery on your profile, is what changes this. When an employer is interested, it appears here and we email you."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {matches.map((match) => (
            <li key={match.roleId}>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-ink-950">{match.roleTitle}</h2>
                    {match.compensation?.compensation && (
                      <p className="mt-1 text-sm text-ink-700">
                        {formatCompensationRange(match.compensation.compensation)}
                      </p>
                    )}
                  </div>
                  {match.mutual ? (
                    <Badge tone="accent">You both said yes</Badge>
                  ) : match.employerInterest === 'interested' ? (
                    /*
                      Two different situations wore the same neutral badge.
                      An employer who has said yes to somebody who has not
                      answered is the only row on this page that is waiting
                      on the candidate, and it read exactly like a row that
                      wanted nothing.
                    */
                    <Badge tone={match.candidateInterest ? 'neutral' : 'accent'}>
                      {match.candidateInterest
                        ? 'They are interested'
                        : 'Interested · needs your answer'}
                    </Badge>
                  ) : null}
                </div>

                {match.fitReason && (
                  <p className="mt-2 break-words text-sm text-ink-700">{match.fitReason}</p>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {match.candidateInterest === 'interested' ? (
                    <>
                      <Badge tone="accent">You said yes</Badge>
                      <Button
                        variant="secondary"
                        disabled={savingRoleId === match.roleId}
                        onClick={() => void answer(match.roleId, 'declined')}
                      >
                        {savingRoleId === match.roleId ? 'Saving…' : 'Change to not interested'}
                      </Button>
                    </>
                  ) : match.candidateInterest === 'declined' ? (
                    <>
                      <Badge tone="neutral">You said no</Badge>
                      <Button
                        variant="secondary"
                        disabled={savingRoleId === match.roleId}
                        onClick={() => void answer(match.roleId, 'interested')}
                      >
                        {savingRoleId === match.roleId ? 'Saving…' : 'Change to interested'}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        disabled={savingRoleId === match.roleId}
                        onClick={() => void answer(match.roleId, 'interested')}
                      >
                        {savingRoleId === match.roleId ? 'Saving…' : 'I am interested'}
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={savingRoleId === match.roleId}
                        onClick={() => void answer(match.roleId, 'declined')}
                      >
                        Not for me
                      </Button>
                    </>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
