import type { FeatureFlags } from '@zoryvex/config';
import {
  CONTACT_UNLOCK_ALLOWANCE,
  MARKETPLACE_GATE_MIN_MATCHES,
  type AccessState,
  type AuditEvent,
  type Candidate,
  type Match,
  type Role,
} from '@zoryvex/contracts';
import { contactUnlockPeriod, type ContactUnlockOutcome } from '../repositories/match-repository';
import { redactAiOutput } from './matching-service';
import { ForbiddenError, NotFoundError } from '../errors/typed-errors';
import type { Clock } from '../repositories/clock-repository';
import { grantsMarketplaceAccess } from './billing-state';

export interface ContactUnlockDependencies {
  clock: Clock;
  getFeatureFlags(): Promise<FeatureFlags>;
  getRole(roleId: string): Promise<{ role: Role; version: number } | null>;
  getMatch(roleId: string, candidateId: string): Promise<Match | null>;
  getCandidate(candidateId: string): Promise<{ candidate: Candidate; version: number } | null>;
  /**
   * How many matches this role has, for the marketplace gate.
   *
   * docs/DATA_MODEL.md access pattern #6, which the repository comment
   * already calls the gate-count query — it just had no caller enforcing a
   * threshold.
   */
  countMatchesForRole(roleId: string): Promise<number>;
  getEntitlementPlan(employerId: string): Promise<string | null>;
  /**
   * Whether this organization's subscription currently grants anything.
   *
   * Separate from the plan on purpose, because the plan alone was the whole
   * check and the plan alone is not enough. `getEntitlementPlan` returns
   * `entitlement.plan` and has never looked at `entitlement.status`, so an
   * employer whose subscription lapsed kept a plan name and kept spending
   * five contact unlocks a month against it. Access is the field that goes
   * to zero when the money stops.
   */
  getMarketplaceAccess(employerId: string): Promise<AccessState>;
  unlockContactAtomic(
    roleId: string,
    candidateId: string,
    employerId: string,
    allowance: number,
    period: string,
  ): Promise<ContactUnlockOutcome>;
  appendAuditEvent(event: AuditEvent): Promise<AuditEvent>;
  /**
   * Tell the candidate their contact was shared, and with whom.
   *
   * The employer's confirmation dialog has always said "the candidate is
   * notified that you've unlocked their contact", and the local demo path
   * really does send that mail. This path did not: it flipped a flag,
   * wrote an audit event, and left the candidate to find out by receiving
   * an unexpected email from a stranger. A person who agreed to be
   * contacted still gets to know when it happens.
   */
  notifyCandidateOfUnlock(notice: {
    email: string;
    displayName: string;
    roleTitle: string;
  }): Promise<void>;
  generateId(): string;
}

/**
 * Every Match this service hands back goes through the same redaction the
 * match list uses.
 *
 * matching-service's own note explains why that redaction exists: a stored
 * aiExplanation can outlive the flag that produced it, so the API strips it
 * from every match response rather than trusting it was never written. This
 * path was returning a Match without it, so an unlock could have surfaced an
 * explanation while aiMatching was off - which is the one thing the design
 * was built to prevent. Unreachable today, because nothing has ever written
 * one in this environment, and cheap enough that reachability is not the
 * standard to hold it to.
 */
function redactOne(match: Match, flags: FeatureFlags): Match {
  return redactAiOutput([match], flags)[0]!;
}

export interface ContactUnlockResult {
  match: Match;
  alreadyUnlocked: boolean;
}

/**
 * Contact-unlock is always a server-side entitlement transaction — never
 * client-asserted (Prompt 7). Requires, in order: the requesting employer
 * owns the role, a real match exists, the role has passed the marketplace
 * gate, the candidate has explicitly consented to contact sharing
 * (docs/DATA_MODEL.md privacy rules — never assumed), and the employer has a
 * plan with a nonzero allowance. The actual increment is atomic
 * (match-repository.ts's unlockContactAtomic) so two concurrent unlocks can
 * never both succeed past the allowance.
 */
export async function unlockContact(
  employerId: string,
  roleId: string,
  candidateId: string,
  deps: ContactUnlockDependencies,
): Promise<ContactUnlockResult> {
  // scripts/emergency-cost-lockdown.mjs sets this flag false and its own
  // documentation says it "disables AI, contact unlock and expensive jobs".
  // The contact-unlock half was a no-op: nothing read the flag. During a
  // real incident the founder would have run the lockdown, seen it succeed,
  // and contact unlocks would have carried on spending allowance and
  // disclosing addresses (found in a 2026-08-27 audit).
  //
  // Checked before the allowance transaction, so a lockdown cannot leave an
  // employer charged for an unlock that did not happen.
  const flags = await deps.getFeatureFlags();
  if (!flags.contactUnlocks) {
    throw new ForbiddenError(
      'Contact unlocks are paused right now. Your allowance has not been used.',
    );
  }

  const roleResult = await deps.getRole(roleId);
  if (!roleResult || roleResult.role.employerId !== employerId)
    throw new NotFoundError('Role not found');

  const match = await deps.getMatch(roleId, candidateId);
  if (!match) throw new NotFoundError('Match not found');
  if (match.contactUnlocked) return { match: redactOne(match, flags), alreadyUnlocked: true };

  // The buyer's own state, checked before anything about the role or the
  // candidate. An organization that is not currently paying should not
  // learn how many matches a role has or whether a particular candidate
  // consented to be contacted; both are things the product sells.
  //
  // `grace` grants access, which is the point of a grace window: a card
  // that failed on Friday is not the same as a subscription that ended.
  const access = await deps.getMarketplaceAccess(employerId);
  if (!grantsMarketplaceAccess(access)) {
    throw new ForbiddenError(
      access === 'suspended'
        ? 'Your subscription needs a working card before contact details open again. Your ' +
            'allowance has not been used.'
        : 'This organization has no active subscription. Your allowance has not been used.',
    );
  }

  // The marketplace gate, server-side. docs/COMMERCIAL_RUNBOOK.md requires
  // the eligibility check to pass server-side and it never did: the number
  // lived in apps/web's role page, so the only thing standing between an
  // employer and a marketplace with three people in it was the browser.
  //
  // Checked before the candidate's consent and before the allowance, because
  // when a role is under the threshold that is the reason, and telling an
  // employer their candidate declined would be both wrong and unkind.
  const matchCount = await deps.countMatchesForRole(roleId);
  // The floor is one match since 2026-09-02, the same number that opens a
  // subscription. An employer allowed to buy on a single match must be
  // allowed to reach that match, or they have bought nothing.
  if (matchCount < MARKETPLACE_GATE_MIN_MATCHES) {
    throw new ForbiddenError(
      'This role has no matching candidates yet, so there is no contact to open. Your allowance ' +
        'has not been used. Recompute matches after widening the role.',
    );
  }

  const candidateResult = await deps.getCandidate(candidateId);
  if (!candidateResult?.candidate.contactUnlockConsent) {
    throw new ForbiddenError('This candidate has not consented to contact sharing');
  }

  const plan = (await deps.getEntitlementPlan(employerId)) ?? 'none';
  const allowance = CONTACT_UNLOCK_ALLOWANCE[plan as keyof typeof CONTACT_UNLOCK_ALLOWANCE] ?? 0;
  if (allowance === 0) {
    throw new ForbiddenError('No active subscription allowance for contact unlocks');
  }

  // The allowance is per billing period, so the ledger this increments is
  // keyed by period too — see match-repository.ts's ledgerKey.
  const outcome = await deps.unlockContactAtomic(
    roleId,
    candidateId,
    employerId,
    allowance,
    contactUnlockPeriod(deps.clock.now()),
  );
  if (!outcome.allowed) {
    if (outcome.reason === 'already_unlocked_or_not_found') {
      const refreshed = await deps.getMatch(roleId, candidateId);
      if (refreshed?.contactUnlocked) {
        return { match: redactOne(refreshed, flags), alreadyUnlocked: true };
      }
      throw new NotFoundError('Match not found');
    }
    throw new ForbiddenError('Contact-unlock allowance exhausted for this billing period');
  }

  const now = deps.clock.now().toISOString();
  await deps.appendAuditEvent({
    id: deps.generateId(),
    actorId: employerId,
    actorRole: 'employer',
    action: 'contact_unlock',
    targetType: 'match',
    targetId: candidateId,
    createdAt: now,
  });

  // After the transaction and the audit event, and never allowed to undo
  // either. The allowance is already spent and the flag already flipped, so
  // throwing here would report a failure for something that succeeded and
  // would tempt a retry that spends a second unlock. A send that fails
  // instead leaves its own audit row, which is what the founder's exception
  // queue reads.
  try {
    await deps.notifyCandidateOfUnlock({
      email: candidateResult.candidate.email,
      displayName: candidateResult.candidate.displayName,
      roleTitle: roleResult.role.title,
    });
  } catch {
    await deps.appendAuditEvent({
      id: deps.generateId(),
      actorId: employerId,
      actorRole: 'employer',
      action: 'contact_unlock_notice_failed',
      targetType: 'match',
      targetId: candidateId,
      reason: 'The candidate was not told their contact was shared. Notify them manually.',
      createdAt: now,
    });
  }

  return { match: redactOne(outcome.match, flags), alreadyUnlocked: false };
}

/**
 * What the candidate is told. Names the role and says what to expect next,
 * because "someone unlocked your contact" without that context reads as a
 * breach notice rather than the thing they agreed to.
 *
 * No employer name: an employer that has paid to reach a candidate has not
 * agreed to have its own hiring plans disclosed, and the candidate will see
 * who it is in the message that follows.
 */
export function contactUnlockNoticeBody(input: {
  displayName: string;
  roleTitle: string;
  settingsUrl: string;
}): string {
  const { displayName, roleTitle, settingsUrl } = input;

  return [
    `Hi ${displayName},`,
    '',
    `An employer hiring for "${roleTitle}" has used one of their contact unlocks on your`,
    'profile. They can now see your email address and may write to you directly.',
    '',
    'You are getting this because you turned on contact sharing. You can turn it off at any',
    'time, and employers who have already unlocked your contact keep what they have.',
    '',
    settingsUrl,
  ].join('\n');
}

export interface GetUnlockedContactDependencies {
  getFeatureFlags(): Promise<FeatureFlags>;
  getRole(roleId: string): Promise<{ role: Role; version: number } | null>;
  getMatch(roleId: string, candidateId: string): Promise<Match | null>;
  getCandidate(candidateId: string): Promise<{ candidate: Candidate; version: number } | null>;
}

export interface UnlockedContactInfo {
  email: string;
  displayName: string;
  /**
   * Only present when the candidate gave them. Carried on the same response
   * as the email rather than on a route of their own, so there is exactly
   * one gate to get right: the flag check, the ownership check, the unlock
   * check and the consent re-check above all apply to these identically. A
   * second endpoint would be a second place to forget one of them.
   */
  phone?: string;
  linkedinUrl?: string;
  websiteUrl?: string;
}

/**
 * Read-only lookup, strictly gated on a PRIOR successful unlockContact call
 * (match.contactUnlocked === true) — never a substitute for it, never
 * reachable any other way. This is the missing other half of the unlock
 * feature: unlockContact only ever flipped a flag and logged an audit
 * event, with no route anywhere that actually returned the candidate's
 * contact details afterward (found during a 2026-08-26 audit — see
 * docs/DECISIONS.md). CLAUDE.md: "Do not expose contact information before
 * the appropriate match/permission stage" — this is that stage, and
 * strictly only that stage.
 */
export async function getUnlockedContactInfo(
  employerId: string,
  roleId: string,
  candidateId: string,
  deps: GetUnlockedContactDependencies,
): Promise<UnlockedContactInfo> {
  // Gated on the read too, not only on the purchase. A kill switch that
  // stops new unlocks while every already-unlocked address keeps being
  // served is not a kill switch — the same read-path gap that made the
  // aiMatching flag ineffective.
  const flags = await deps.getFeatureFlags();
  if (!flags.contactUnlocks) {
    throw new ForbiddenError('Contact details are temporarily unavailable.');
  }

  const roleResult = await deps.getRole(roleId);
  if (!roleResult || roleResult.role.employerId !== employerId)
    throw new NotFoundError('Role not found');

  const match = await deps.getMatch(roleId, candidateId);
  if (!match || !match.contactUnlocked) {
    throw new ForbiddenError('Contact has not been unlocked for this candidate');
  }

  const candidateResult = await deps.getCandidate(candidateId);
  if (!candidateResult) throw new NotFoundError('Candidate not found');

  // Consent is re-checked on every disclosure, not only at unlock time.
  //
  // privacy-service.ts advertises consent as "reversible (a later call
  // simply supersedes the previous state)" — Prompt 7's explicit
  // requirement. It was not: unlockContact checked contactUnlockConsent, but
  // this route, the one that actually returns the email address, checked
  // only match.contactUnlocked. A candidate who revoked contact consent kept
  // having their email served to the employer on every request, forever,
  // with revocation having no effect on the single endpoint that discloses
  // it (found in a 2026-08-27 audit).
  //
  // A past disclosure cannot be taken back, and this does not pretend
  // otherwise. What it stops is the ONGOING re-disclosure, which is the part
  // revocation can actually control. The employer keeps the unlock itself
  // (match.contactUnlocked stays true, the allowance stays spent) so no
  // paid action is silently undone — if the candidate consents again, the
  // contact becomes readable again with no second charge.
  if (!candidateResult.candidate.contactUnlockConsent) {
    throw new ForbiddenError('This candidate has withdrawn consent to contact sharing');
  }

  const { email, displayName, phone, linkedinUrl, websiteUrl } = candidateResult.candidate;
  return {
    email,
    displayName,
    // Spread conditionally so an absent channel is absent from the response
    // rather than present and null. An employer's UI should not have to tell
    // "they did not give a number" apart from "the field exists and is
    // empty", and neither should anything reading the audit log.
    ...(phone ? { phone } : {}),
    ...(linkedinUrl ? { linkedinUrl } : {}),
    ...(websiteUrl ? { websiteUrl } : {}),
  };
}
