'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getLocalAdapters } from '@zoryvex/local-adapters';
import {
  LAUNCH_TRACK_LABELS,
  MARKETPLACE_GATE_MIN_MATCHES,
  type InterestState,
  type Candidate,
  type KitOrder,
  type Match,
  type Role,
  byStrongestMatch,
} from '@zoryvex/contracts';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Button, ButtonLink } from '@/components/ui/Button';
import { StatusState } from '@/components/ui/StatusState';
import { PageHeader, Section } from '@/components/layout/Section';
import { ProofItem } from '@/components/employer/ProofItem';
import { KitDeliverablesView } from '@/components/employer/KitDeliverablesView';
import { MatchCard } from '@/components/employer/MatchCard';
import { MatchStrength } from '@/components/employer/MatchStrength';
import { OpenToLine } from '@/components/employer/OpenToLine';
import { ClosestFitNote } from '@/components/employer/ClosestFitNote';
import { generateKitDeliverables } from '@zoryvex/kit-templates';
import { CONTACT_UNLOCK_ALLOWANCE, countContactUnlocksUsed } from '@/lib/entitlements';
import { useSession } from '@/lib/use-session';
import { useToast } from '@/components/ui/Toast';
import { PageLoading, Skeleton } from '@/components/ui/PageLoading';
import {
  RealApiError,
  isRealApiConfigured,
  messageFor,
  realBilling,
  realKit,
  realMatches,
  realRoles,
  type UnlockedContactInfo,
  type VerifiedEvidenceSummary,
} from '@/lib/real-api';

/**
 * Sorted here because neither store returns matches in an order that means
 * anything: the local one returns key order and DynamoDB returns sort-key
 * order, which is candidate id. Reading the demo store directly gave 0.75,
 * 0.80, 0.60, 0.70, 0.65. A list cannot say "this order means nothing",
 * because a reader starts at the top and assumes the first row is the best
 * one.
 *
 * The rule is byStrongestMatch from contracts, not a copy of it. This page
 * held its own, ranking by score and evidence strength alone, while the API
 * ranked by how well a candidate fitted what the role actually asked for.
 * This sort runs last and wins, so the API rule reached nobody: an employer
 * who said they could only employ in one country still saw a candidate
 * outside it at the top of the list. One product decision, defined twice,
 * and the copy on screen was the wrong one.
 */

function RoleDetailContent() {
  const session = useSession();
  const { showToast } = useToast();
  const useReal = isRealApiConfigured();
  const searchParams = useSearchParams();
  const roleId = searchParams.get('id');
  const [role, setRole] = useState<Role | null | undefined>(undefined);
  const [kitOrder, setKitOrder] = useState<KitOrder | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [candidatesById, setCandidatesById] = useState<Record<string, Candidate>>({});
  const [allowanceUsed, setAllowanceUsed] = useState(0);
  const [allowanceTotal, setAllowanceTotal] = useState(0);
  /**
   * Whether the allowance above is an answer or just its starting value.
   *
   * Three situations were collapsed into two. A zero total rendered
   * "Contact unlocks need a subscription", and the total is zero both when
   * an employer genuinely has no subscription and when nobody has asked
   * yet. So every paying subscriber was told they had no subscription on
   * each page load until billing resolved, and permanently whenever that
   * call failed, which is settled rather than awaited precisely so a blip
   * does not take the page down.
   *
   * Telling somebody who pays that they do not is the worst reading of the
   * three, so silence is used for "not known" instead.
   */
  const [allowanceKnown, setAllowanceKnown] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  // The client's own type rather than a copy of its fields. This was a hand
  // written duplicate, so adding a contact channel to the API left this page
  // silently unable to see it: the data arrived and the type said it had not.
  const [contactsById, setContactsById] = useState<Record<string, UnlockedContactInfo>>({});
  const [interestSavingId, setInterestSavingId] = useState<string | null>(null);
  const [interestError, setInterestError] = useState<string | null>(null);
  /**
   * Whether the last yes was refused for want of a subscription.
   *
   * Separate from `interestError` because the two want different words and
   * different offers: one is "that did not save, try again", the other is
   * "this is what the subscription is for", and showing the first for the
   * second tells an employer to retry something that will never work.
   */
  const [interestNeedsPlan, setInterestNeedsPlan] = useState(false);
  const [unlockingId, setUnlockingId] = useState<string | null>(null);
  const [loadingContactId, setLoadingContactId] = useState<string | null>(null);
  const [kitStatus, setKitStatus] = useState<'succeeded' | 'none' | null>(null);
  const [loadingKit, setLoadingKit] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(() => {
    if (!roleId || !session?.employerId) return;

    if (useReal) {
      setLoadFailed(false);
      Promise.all([
        realRoles.getRole(roleId),
        realMatches.listMatches(roleId),
        realKit.getStatus(roleId),
        // Settled rather than awaited with the rest: the allowance badge
        // is worth having, and it is not worth replacing the role an
        // employer came to read with an error page when billing has a
        // blip.
        Promise.allSettled([realBilling.getBilling()]),
      ])
        .then(([{ role: found }, roleMatches, kit, [billing]]) => {
          setRole(found);
          setMatches(byStrongestMatch(roleMatches));
          setKitStatus(kit.status);
          if (billing.status === 'fulfilled') {
            setAllowanceTotal(billing.value.overview.contactUnlockAllowance);
            setAllowanceUsed(billing.value.overview.contactUnlocksUsedThisPeriod);
            setAllowanceKnown(true);
          }
        })
        .catch((error) => {
          // A genuine "not found or not yours" is a real, permanent answer -
          // anything else (network blip, server error) is not, and showing
          // the same "you don't have access" message for both would tell a
          // real employer they've lost access to their own role when really
          // the request just failed and a retry might well succeed.
          if (error instanceof RealApiError && (error.status === 403 || error.status === 404)) {
            setRole(null);
          } else {
            setLoadFailed(true);
          }
        });
      return;
    }

    const { data } = getLocalAdapters();
    const found = data.getRole(roleId);
    if (!found || found.employerId !== session.employerId) {
      setRole(null);
      return;
    }
    setRole(found);
    setKitOrder(data.getKitOrderForRole(roleId));

    const roleMatches = byStrongestMatch(data.listMatchesForRole(roleId));
    setMatches(roleMatches);
    const byId: Record<string, Candidate> = {};
    for (const match of roleMatches) {
      const candidate = data.getCandidate(match.candidateId);
      if (candidate) byId[candidate.id] = candidate;
    }
    setCandidatesById(byId);

    const entitlement = data.getEntitlement(session.employerId);
    setAllowanceTotal(CONTACT_UNLOCK_ALLOWANCE[entitlement?.plan ?? 'none']);
    setAllowanceUsed(countContactUnlocksUsed(data, session.employerId));
    // The local store answers synchronously, so by here it is an answer.
    setAllowanceKnown(true);
  }, [roleId, session, useReal]);

  useEffect(refresh, [refresh]);

  async function handleRecompute() {
    if (!roleId) return;
    setRecomputing(true);
    try {
      const {
        matches: recomputed,
        locationExcluded,
        beyondRequirements,
      } = await realMatches.recomputeMatches(roleId);
      setMatches(byStrongestMatch(recomputed));
      // Nobody is removed any more, so this no longer reports a loss. It
      // reports the shape of the list: how many of these people your
      // location is stretching, and how many your written requirements are
      // talking past. Both are decisions an employer can act on, and neither
      // is visible from a count of cards.
      const scored = `Recomputed: ${recomputed.length} match(es) scored.`;
      const notes: string[] = [];
      if (locationExcluded > 0) {
        notes.push(`${locationExcluded} meet your requirements but sit outside your location.`);
      }
      if (beyondRequirements > 0) {
        notes.push(
          `${beyondRequirements} have verified proof of neighbouring work, shown lower down.`,
        );
      }
      showToast([scored, ...notes].join(' '), 'success');
    } catch (error) {
      showToast(messageFor(error, "Couldn't recompute matches. Try again."), 'error');
    } finally {
      setRecomputing(false);
    }
  }

  /**
   * The employer's half of a mutual match.
   *
   * Re-reads the list afterwards rather than patching the row in place:
   * whether this made the match mutual depends on the candidate's own
   * answer, which only the server knows, and guessing it here would put a
   * second copy of that rule in the browser.
   */
  async function handleSetInterest(candidateId: string, interest: InterestState) {
    if (!roleId) return;
    setInterestSavingId(candidateId);
    setInterestError(null);
    setInterestNeedsPlan(false);
    try {
      await realMatches.setEmployerInterest(roleId, candidateId, interest);
      setMatches(byStrongestMatch(await realMatches.listMatches(roleId)));
    } catch (error: unknown) {
      // A refusal for want of a subscription is not a fault, and "try again"
      // would send an employer round a loop that cannot succeed. The server
      // words it; this only decides whether to offer the way out.
      if (error instanceof RealApiError && error.status === 403) {
        setInterestNeedsPlan(true);
        setInterestError(null);
      } else {
        setInterestError(messageFor(error, 'That did not save. Try again.'));
      }
    } finally {
      setInterestSavingId(null);
    }
  }

  async function handleUnlockContact(candidateId: string) {
    if (!roleId) return;
    setUnlockingId(candidateId);
    try {
      const { match: updated } = await realMatches.unlockContact(roleId, candidateId);
      setMatches((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      const contact = await realMatches.getContact(roleId, candidateId);
      setContactsById((prev) => ({ ...prev, [candidateId]: contact }));
      showToast('Contact unlocked.', 'success');
    } catch (error) {
      // A refusal here has several genuinely different causes, and the
      // server words each one for a human: no subscription allowance, the
      // allowance used up for this period, the candidate not having
      // consented, the role under the marketplace threshold, or a lapsed
      // subscription. Surfacing the server's own sentence tells the
      // employer which one applies; guessing told them something untrue.
      showToast(messageFor(error, "Couldn't unlock this contact. Try again."), 'error');
    } finally {
      setUnlockingId(null);
    }
  }

  async function handleShowContact(candidateId: string) {
    if (!roleId) return;
    setLoadingContactId(candidateId);
    try {
      const contact = await realMatches.getContact(roleId, candidateId);
      setContactsById((prev) => ({ ...prev, [candidateId]: contact }));
    } catch {
      showToast("Couldn't load this candidate's contact.", 'error');
    } finally {
      setLoadingContactId(null);
    }
  }

  async function handleViewKit() {
    if (!roleId) return;
    setLoadingKit(true);
    try {
      const html = await realKit.getDownloadHtml(roleId);
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      // Revoked after a delay, not immediately — the new tab needs the
      // blob URL to still resolve when it actually loads it.
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      showToast("Couldn't load the Kit document. Try again.", 'error');
    } finally {
      setLoadingKit(false);
    }
  }

  if (!roleId) return <StatusState kind="404" title="No role specified" />;
  if (loadFailed) {
    return (
      <Section className="max-w-md">
        <StatusState
          kind="500"
          action={
            <Button variant="secondary" onClick={refresh}>
              Try again
            </Button>
          }
        />
      </Section>
    );
  }
  if (role === undefined) {
    return (
      <Section>
        <PageLoading blocks={3} />
      </Section>
    );
  }
  if (role === null) return <StatusState kind="403" />;

  // The same gate both modes are subject to, computed the same way. The real
  // branch used to offer an Unlock contact button on every match regardless,
  // which the server then refused: an employer under the threshold got a
  // button, a click, and a 403 explaining a rule the page had never mentioned.
  /**
   * Unreachable while MARKETPLACE_GATE_MIN_MATCHES is 1, and deliberately
   * kept anyway.
   *
   * The zero-match branch below catches the only case where this is false at
   * a gate of one, so the partial anonymized list that follows cannot render
   * today. It is dead at the current value rather than structurally dead: the
   * gate was 5 until 2026-09-02 and is a founder decision that can move back,
   * and deleting the UI would mean a future raise silently ships without the
   * preview state it needs.
   *
   * Flagged rather than quietly left: untestable code rots, so if the gate is
   * not going to rise again this block should be removed on purpose.
   */
  const gateOpen = matches.length >= MARKETPLACE_GATE_MIN_MATCHES;

  if (useReal) {
    return (
      <Section>
        <PageHeader title={role.title} intro={LAUNCH_TRACK_LABELS[role.launchTrack]} />

        <p className="-mt-4 mb-6">
          <a
            href={`/employer/role/edit?id=${role.id}`}
            className="inline-block py-2 text-sm font-medium text-accent-700 underline"
          >
            Edit role
          </a>
        </p>

        <Card className="mb-8">
          <h2 className="font-semibold text-ink-950">Proof Hiring Kit</h2>
          {kitStatus === 'succeeded' ? (
            <>
              <p className="mt-1 text-sm text-accent-700">Purchased.</p>
              <button
                type="button"
                onClick={() => void handleViewKit()}
                disabled={loadingKit}
                className="mt-3 text-sm font-medium text-accent-700 underline disabled:opacity-50"
              >
                {loadingKit ? 'Loading…' : 'View Kit deliverables'}
              </button>
            </>
          ) : (
            <>
              <p className="mt-1 text-sm text-ink-700">Not purchased yet for this role.</p>
              <ButtonLink href={`/employer/role/checkout?id=${role.id}`} className="mt-3">
                Get the Kit
              </ButtonLink>
            </>
          )}
        </Card>

        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-bold text-ink-950">Candidate matches</h2>
            <button
              type="button"
              onClick={() => void handleRecompute()}
              disabled={recomputing}
              className="text-sm font-medium text-accent-700 underline disabled:opacity-50"
            >
              {recomputing ? 'Recomputing…' : 'Recompute matches'}
            </button>
          </div>
          {matches.length === 0 ? (
            /*
              An empty result now says what to do about it, and offers the
              thing that does it.

              Matching runs in the background rather than on page load, so an
              empty list genuinely can mean "computed before that candidate
              existed" as well as "nobody matches". Those need different
              reactions and the old wording described both without
              distinguishing them, leaving the reader with nothing to press.
              Recompute is the action that resolves the ambiguity, and it was
              already on the page, just not where somebody looking at nothing
              would find it.
            */
            <StatusState
              kind="empty"
              title="No matches yet"
              body="Matching runs in the background, so anyone who joined in the last few minutes may not be counted yet. Recompute to look again. If it stays empty, no candidate has opted into discovery for this track and role."
              action={
                <Button
                  variant="secondary"
                  disabled={recomputing}
                  onClick={() => void handleRecompute()}
                >
                  {recomputing ? 'Recomputing…' : 'Recompute matches'}
                </Button>
              }
            />
          ) : !gateOpen ? (
            <div>
              <StatusState
                kind="422"
                title={`${matches.length} of ${MARKETPLACE_GATE_MIN_MATCHES} needed`}
                body={`Contact details open once this role has ${MARKETPLACE_GATE_MIN_MATCHES} real, discovery-opted matches. Everything found so far is below. Recomputing after you widen the must-have work often finds more.`}
              />
              <ul className="mt-4 flex flex-col gap-3">
                {matches.map((match) => (
                  <li key={match.id}>
                    <Card>
                      <div className="flex items-start justify-between gap-4">
                        <p className="min-w-0 text-sm font-medium text-ink-950">
                          Candidate ({match.candidateId.slice(0, 8)})
                        </p>
                        <MatchStrength
                          score={match.matchScore}
                          requirementCount={role.mustHaveWork.length}
                          proofCount={match.matchedEvidenceIds?.length ?? 0}
                        />
                      </div>
                      {match.rationale && (
                        <p className="mt-2 break-words text-xs text-ink-700">{match.rationale}</p>
                      )}
                      {/*
                        The same explanation MatchCard gives above the gate.
                        Nobody is excluded from a shortlist any more: a
                        candidate outside the location requirement, or whose
                        proof backs none of the written must-haves, still
                        appears, marked partial or adjacent. This row showed
                        the score and the rationale and not the one sentence
                        saying why the fit is inexact, so below the gate an
                        employer saw an unfamiliar name with no way to tell
                        whether it was worth their attention.
                      */}
                      {match.fitReason && (
                        <div className="mt-3 border-l-2 border-warm-300 pl-3">
                          <p className="text-xs font-semibold tracking-wide text-ink-700 uppercase">
                            {match.fit === 'adjacent' ? 'Worth a look' : 'Close, not exact'}
                          </p>
                          <p className="mt-1 text-sm text-ink-700">{match.fitReason}</p>
                        </div>
                      )}
                      <OpenToLine openTo={match.candidateOpenTo} />
                      <MatchProof
                        roleId={roleId}
                        candidateId={match.candidateId}
                        supportingCount={match.matchedEvidenceIds?.length ?? 0}
                      />
                    </Card>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {matches.map((match) => {
                const contact = contactsById[match.candidateId];
                return (
                  <li key={match.id}>
                    <Card>
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink-950">
                            Candidate ({match.candidateId.slice(0, 8)})
                          </p>
                          <p className="text-sm text-ink-700">{match.status}</p>
                        </div>
                        <MatchStrength
                          score={match.matchScore}
                          requirementCount={role.mustHaveWork.length}
                          proofCount={match.matchedEvidenceIds?.length ?? 0}
                        />
                      </div>
                      {match.rationale && (
                        <p className="mt-2 break-words text-xs text-ink-700">{match.rationale}</p>
                      )}
                      <MatchProof
                        roleId={roleId}
                        candidateId={match.candidateId}
                        supportingCount={match.matchedEvidenceIds?.length ?? 0}
                      />
                      {match.contactUnlocked ? (
                        contact ? (
                          /*
                            Every channel this candidate chose to give, and
                            nothing more. A candidate who gave neither shows
                            an email address exactly as before, rather than
                            two empty rows implying they withheld something.
                          */
                          <div className="mt-3 flex flex-col gap-1 text-sm font-medium text-accent-700">
                            <p>Contact unlocked · {contact.email}</p>
                            {contact.phone && <p>Phone · {contact.phone}</p>}
                            {contact.linkedinUrl && (
                              <a
                                href={contact.linkedinUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600"
                              >
                                LinkedIn profile
                              </a>
                            )}
                            {contact.websiteUrl && (
                              <a
                                href={contact.websiteUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="break-all underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600"
                              >
                                {contact.websiteUrl}
                              </a>
                            )}
                            {contact.websiteUrl && (
                              /*
                                Said rather than implied. The LinkedIn field is
                                pinned to one host, so naming it is a fact.
                                This one can point anywhere, and an employer
                                reading it beside checked proofs would
                                reasonably assume it carried the same weight.
                                It does not, and the product says so in the
                                same words it uses for a colleague's
                                confirmation.
                              */
                              <span className="text-xs font-normal text-ink-700">
                                A link they gave. Zoryvex has not checked what is behind it.
                              </span>
                            )}
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void handleShowContact(match.candidateId)}
                            disabled={loadingContactId === match.candidateId}
                            className="mt-3 text-sm font-medium text-accent-700 underline disabled:opacity-50"
                          >
                            {loadingContactId === match.candidateId ? 'Loading…' : 'Show contact'}
                          </button>
                        )
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleUnlockContact(match.candidateId)}
                          disabled={unlockingId === match.candidateId}
                          className="mt-3 text-sm font-medium text-accent-700 underline disabled:opacity-50"
                        >
                          {unlockingId === match.candidateId ? 'Unlocking…' : 'Unlock contact'}
                        </button>
                      )}

                      {/*
                        Saying yes is free and spends no allowance. It sits
                        beside the unlock deliberately: the cheap question
                        is whether this is worth a conversation at all, and
                        an employer who answers it first finds out whether
                        the interest is returned before paying to reach
                        somebody who may not want the role.
                      */}
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-warm-200 pt-3">
                        {match.candidateInterest === 'interested' &&
                        match.employerInterest === 'interested' ? (
                          <Badge tone="accent">You both said yes</Badge>
                        ) : match.candidateInterest === 'interested' ? (
                          <Badge tone="accent">They are interested</Badge>
                        ) : match.candidateInterest === 'declined' ? (
                          <Badge tone="neutral">They passed on this role</Badge>
                        ) : null}

                        {match.employerInterest === 'interested' ? (
                          <button
                            type="button"
                            onClick={() => void handleSetInterest(match.candidateId, 'declined')}
                            disabled={interestSavingId === match.candidateId}
                            className="text-sm font-medium text-ink-700 underline disabled:opacity-50"
                          >
                            {interestSavingId === match.candidateId
                              ? 'Saving…'
                              : 'You said yes · change'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void handleSetInterest(match.candidateId, 'interested')}
                            disabled={interestSavingId === match.candidateId}
                            className="text-sm font-medium text-accent-700 underline disabled:opacity-50"
                          >
                            {interestSavingId === match.candidateId
                              ? 'Saving…'
                              : "I'm interested in this candidate"}
                          </button>
                        )}
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Section>
    );
  }

  const kitPurchased = kitOrder?.status === 'succeeded';

  return (
    <Section>
      <PageHeader title={role.title} intro={LAUNCH_TRACK_LABELS[role.launchTrack]} />

      <p className="-mt-4 mb-6">
        <a
          href={`/employer/role/edit?id=${role.id}`}
          className="inline-block py-2 text-sm font-medium text-accent-700 underline"
        >
          Edit role
        </a>
      </p>

      <Card className="mb-8">
        <h2 className="font-semibold text-ink-950">Proof Hiring Kit</h2>
        {kitPurchased ? (
          <p className="mt-1 text-sm text-accent-700">Purchased. Deliverables below.</p>
        ) : kitOrder?.status === 'pending' ? (
          <p className="mt-1 text-sm text-ink-700">Payment pending.</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-ink-700">Not purchased yet for this role.</p>
            <ButtonLink href={`/employer/role/checkout?id=${role.id}`} className="mt-3">
              Get the Kit
            </ButtonLink>
          </>
        )}
      </Card>

      {kitPurchased && (
        <div className="mb-10">
          <h2 className="mb-4 text-xl font-bold text-ink-950">Kit deliverables</h2>
          <KitDeliverablesView deliverables={generateKitDeliverables(role)} />
        </div>
      )}

      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-ink-950">Candidate matches</h2>
          {/*
            Nothing at all until the answer is known. Saying "needs a
            subscription" while the question is still outstanding is what
            told paying subscribers they had none, on every load and forever
            if billing was unreachable.
          */}
          {allowanceKnown &&
            (allowanceTotal > 0 ? (
              <Badge tone={allowanceUsed >= allowanceTotal ? 'error' : 'neutral'}>
                {allowanceUsed} / {allowanceTotal} contact unlocks used this period
              </Badge>
            ) : (
              /*
                No subscription, so no allowance, and no number to report.
                This used to render "0 / 0 contact unlocks used this period"
                to every real subscriber as well, because the counts were
                only ever filled in on the local demo path.
              */
              <Badge tone="neutral">Contact unlocks need a subscription</Badge>
            ))}
        </div>

        {interestError && (
          <div role="alert" className="mb-3">
            <StatusState kind="500" title="That did not save" body={interestError} />
          </div>
        )}

        {interestNeedsPlan && (
          <div role="alert" className="mb-3">
            <Card className="border-accent-700">
              <p className="font-semibold text-ink-950">
                Telling a candidate you are interested needs a subscription
              </p>
              <p className="mt-2 text-sm text-ink-700">
                Nothing was sent and this candidate has not been told anything. A subscription is
                what lets you say yes, see where each proof was checked, and unlock contact details
                when the interest is returned.
              </p>
              <ButtonLink href="/employer/billing" className="mt-4">
                See the plans
              </ButtonLink>
            </Card>
          </div>
        )}

        <ClosestFitNote matches={matches} />

        {matches.length === 0 ? (
          <StatusState
            kind="empty"
            title="No matches yet"
            body="Matching runs in the background, so anyone who joined in the last few minutes may not be counted yet. Recompute to look again. If it stays empty, no candidate has opted into discovery for this track and role."
            action={
              <Button
                variant="secondary"
                disabled={recomputing}
                onClick={() => void handleRecompute()}
              >
                {recomputing ? 'Recomputing…' : 'Recompute matches'}
              </Button>
            }
          />
        ) : !gateOpen ? (
          <div>
            <StatusState
              kind="422"
              title={`${matches.length} of ${MARKETPLACE_GATE_MIN_MATCHES} needed`}
              body={`The marketplace unlocks once this role has ${MARKETPLACE_GATE_MIN_MATCHES} real, discovery-opted matches. Here's what exists so far, not yet available to contact through the marketplace.`}
            />
            <ul className="mt-4 flex flex-col gap-3">
              {matches.map((match) => {
                const candidate = candidatesById[match.candidateId];
                if (!candidate) return null;
                return (
                  <li key={match.id}>
                    <Card>
                      <div className="flex items-start justify-between gap-4">
                        <p className="min-w-0 text-sm font-medium text-ink-950">
                          Candidate ({candidate.id.slice(0, 6)})
                        </p>
                        <MatchStrength
                          score={match.matchScore}
                          requirementCount={role.mustHaveWork.length}
                        />
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {matches.map((match) => {
              const candidate = candidatesById[match.candidateId];
              if (!candidate) return null;
              return (
                <li key={match.id}>
                  <MatchCard
                    match={match}
                    candidate={candidate}
                    role={role}
                    employerId={role.employerId}
                    onUnlocked={refresh}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Section>
  );
}

export default function RoleDetailPage() {
  return (
    <Suspense fallback={null}>
      <RoleDetailContent />
    </Suspense>
  );
}

/**
 * The proof behind a match, on demand.
 *
 * The rationale above names evidence by id ("supported by verified evidence
 * ev_1"), which is a database key. An employer paying for verified talent
 * should be able to see what was actually checked and judge it, rather than
 * being handed an identifier and asked to trust it.
 *
 * Collapsed by default because the list is scanned first and read second,
 * and fetched only when opened so the list itself stays one request.
 */
function MatchProof({
  roleId,
  candidateId,
  supportingCount,
}: {
  roleId: string;
  candidateId: string;
  supportingCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const [items, setItems] = useState<VerifiedEvidenceSummary[]>([]);

  if (supportingCount === 0) return null;

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || items.length > 0 || state === 'loading') return;

    setState('loading');
    try {
      setItems(await realMatches.listMatchEvidence(roleId, candidateId));
      setState('idle');
    } catch {
      // Distinguished from "nothing to show", which would be a quiet lie
      // about a candidate's proof.
      //
      // No separate subscription branch here: the read is served to anyone
      // who owns the role, and it is the source link inside each item that
      // depends on the plan. ProofItem says so per claim, which is more
      // useful than one message over the whole panel because it can name
      // which record is waiting.
      setState('failed');
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => void toggle()}
        aria-expanded={open}
        className="rounded-sm text-sm font-medium text-accent-700 underline transition-colors hover:text-accent-800 active:text-ink-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600"
      >
        {open ? 'Hide what was checked' : `What we checked (${supportingCount})`}
      </button>

      {open && (
        <div className="mt-3 border-t border-warm-200 pt-3">
          {state === 'loading' && (
            <div role="status" aria-live="polite" className="animate-pulse">
              <span className="sr-only">Loading the proof…</span>
              <Skeleton className="h-3 w-full" />
              <Skeleton className="mt-2 h-3 w-4/5" />
            </div>
          )}
          {state === 'failed' && (
            <p className="text-sm text-error-700">
              We could not load the proof for this candidate. Try again in a moment.
            </p>
          )}
          {state === 'idle' && items.length === 0 && (
            <p className="text-sm text-ink-700">
              Nothing is currently verified for this candidate. The evidence may have been edited or
              hidden since this match was scored, or a credential behind it may have lapsed.
            </p>
          )}
          <ul className="flex flex-col gap-3">
            {items.map((item) => (
              <ProofItem key={item.evidenceId} item={item} />
            ))}
          </ul>

          {/*
            Said to the employer because it is true and they would rather
            learn it here than from a candidate mentioning it. Placed after
            the proof rather than in front of it: it is a fact about opening
            this panel, not a warning that should make somebody hesitate to
            read evidence they are paying for.
          */}
          {state === 'idle' && items.length > 0 && (
            <p className="mt-3 text-sm text-ink-700">
              This candidate is told that your organisation opened their proof, once a day at most.
              They are not shown how often, and your contact details are not shared with them.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
