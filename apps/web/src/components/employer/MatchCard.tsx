'use client';

import { useState } from 'react';
import { getLocalAdapters } from '@zoryvex/local-adapters';
import type { Candidate, Evidence, Match, Role } from '@zoryvex/contracts';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { StatusState } from '@/components/ui/StatusState';
import { CONTACT_UNLOCK_ALLOWANCE, countContactUnlocksUsed } from '@/lib/entitlements';
import { proofMarkState } from '@/components/ui/ProofMark';
import { MatchStrength } from '@/components/employer/MatchStrength';
import { OpenToLine } from '@/components/employer/OpenToLine';

export interface MatchCardProps {
  match: Match;
  candidate: Candidate;
  role: Role;
  employerId: string;
  onUnlocked: () => void;
}

export function MatchCard({ match, candidate, role, employerId, onUnlocked }: MatchCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [allowanceExceeded, setAllowanceExceeded] = useState(false);
  const [consentWithdrawn, setConsentWithdrawn] = useState(false);
  const { ai, data, email } = getLocalAdapters();

  const suggestion = ai.suggestMatches(role, [candidate])[0];
  // Live proofs, not shared items. This counted every non-private
  // evidence item including the unchecked ones, so a candidate with one
  // proof and four unverified claims was advertised to an employer as five
  // things to look at — and the four contribute nothing, are never shown,
  // and cannot be. Promising more than the employer gets is the enemy in
  // miniature.
  const proofs = data
    .listCandidateEvidence(candidate.id)
    .filter((e: Evidence) => e.visibility !== 'private' && proofMarkState(e) === 'proved');

  /**
   * The candidate's own consent, checked here for the same reason
   * `unlockContact` checks it server-side: "contact details are only
   * unlocked with the candidate's explicit consent" is a published
   * commitment on /trust-safety, and this path did not honour it.
   *
   * The server has always refused without it. This card did not, so the
   * demo and the e2e suite both showed contacts being unlocked for
   * candidates who had never agreed to it, and would have shown an employer
   * an Unlock button that the real backend answers with a 403.
   */
  const candidateConsented = candidate.contactUnlockConsent === true;

  function hasAllowanceRemaining(): boolean {
    const entitlement = data.getEntitlement(employerId);
    const allowanceTotal = CONTACT_UNLOCK_ALLOWANCE[entitlement?.plan ?? 'none'];
    return countContactUnlocksUsed(data, employerId) < allowanceTotal;
  }

  function handleConfirmUnlock() {
    // Re-read fresh state rather than trusting the `match` prop: another
    // tab/device on the same account may have unlocked this since we last
    // rendered, and a stale prop would silently double-write and double-email.
    const current = data.getMatch(match.roleId, match.candidateId) ?? match;
    // Re-read from the store rather than the prop: a candidate can withdraw
    // consent between this card rendering and the employer confirming, and
    // the withdrawal has to win.
    if (data.getCandidate(match.candidateId)?.contactUnlockConsent !== true) {
      setConfirmOpen(false);
      setConsentWithdrawn(true);
      return;
    }
    if (current.contactUnlocked) {
      setConfirmOpen(false);
      setConflict(true);
      return;
    }
    // Re-checked fresh, not from a snapshot taken when the card rendered —
    // the allowance can be exhausted by another unlock between opening this
    // dialog and confirming it.
    if (!hasAllowanceRemaining()) {
      setConfirmOpen(false);
      setAllowanceExceeded(true);
      return;
    }
    data.upsertMatch({ ...current, contactUnlocked: true, status: 'contacted' });
    email.send(
      candidate.email,
      `An employer unlocked your contact on Zoryvex: ${role.title}`,
      `An employer viewing your profile for their "${role.title}" role has unlocked your contact details. (Local demo. No real email sent.)`,
    );
    setConfirmOpen(false);
    onUnlocked();
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold text-ink-950">
            {match.contactUnlocked
              ? candidate.displayName
              : `Candidate (${candidate.id.slice(0, 6)})`}
          </p>
          <p className="mt-1 text-sm text-ink-700">
            {proofs.length === 0
              ? 'No current proofs'
              : `${proofs.length} current proof${proofs.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <MatchStrength
          score={suggestion?.score ?? match.matchScore}
          requirementCount={role.mustHaveWork.length}
        />
      </div>

      {suggestion && <p className="mt-3 text-sm text-ink-700">{suggestion.rationale}</p>}

      {/*
        Why a near-miss is on the page at all.

        Shown for `partial` and `adjacent` only: a match that answers the role
        as written has nothing to explain, and captioning it would imply a
        reservation nobody has. Stated as the reason it fell short followed by
        what the candidate does have, so an employer can dismiss it in a
        glance or take it seriously on purpose, rather than wondering why an
        unfamiliar name is in their list.
      */}
      {match.fitReason && (
        <div className="mt-3 border-l-2 border-warm-300 pl-3">
          <p className="text-xs font-semibold tracking-wide text-ink-700 uppercase">
            {match.fit === 'adjacent' ? 'Worth a look' : 'Close, not exact'}
          </p>
          <p className="mt-1 text-sm text-ink-700">{match.fitReason}</p>
        </div>
      )}

      {/*
        Beside the fit, because it answers the other half of the same
        question. The fit says how well this person matches the role; this
        says what they told us they want, which is what decides whether an
        unlock is worth spending.
      */}
      <OpenToLine openTo={match.candidateOpenTo} />

      {match.contactUnlocked ? (
        <p className="mt-4 text-sm text-accent-700">Contact unlocked · {candidate.email}</p>
      ) : !candidateConsented ? (
        <p className="mt-4 text-sm text-ink-700">
          This candidate has not agreed to share contact details. You can still read their evidence.
          Nothing is spent from your allowance.
        </p>
      ) : hasAllowanceRemaining() ? (
        <Button variant="secondary" className="mt-4" onClick={() => setConfirmOpen(true)}>
          Unlock contact
        </Button>
      ) : (
        <div className="mt-4">
          <StatusState
            kind="403"
            title="No contact unlocks remaining"
            body="Your plan's contact-unlock allowance for this period is used up."
            action={<ButtonLink href="/employer/billing">Upgrade plan</ButtonLink>}
          />
        </div>
      )}

      {conflict && (
        <div className="mt-3">
          <StatusState kind="409" body="This candidate's contact was already unlocked." />
        </div>
      )}

      {allowanceExceeded && (
        <div className="mt-3">
          <StatusState
            kind="403"
            title="No contact unlocks remaining"
            body="Another unlock used up your plan's allowance for this period."
            action={<ButtonLink href="/employer/billing">Upgrade plan</ButtonLink>}
          />
        </div>
      )}

      {consentWithdrawn && (
        <div className="mt-3">
          <StatusState
            kind="403"
            title="Contact sharing turned off"
            body="This candidate turned off contact sharing while you had this open. Nothing was spent from your allowance."
          />
        </div>
      )}

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Unlock this candidate's contact?"
      >
        <p className="text-sm text-ink-700">
          This counts against your monthly contact-unlock allowance and lets you reach this
          candidate directly. The candidate is notified that you've unlocked their contact.
        </p>
        <div className="mt-4 flex gap-3">
          <Button onClick={handleConfirmUnlock}>Yes, unlock</Button>
          <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
            Cancel
          </Button>
        </div>
      </Dialog>
    </Card>
  );
}
