import { randomBytes, randomUUID } from 'node:crypto';
import { recordGradedAttempt } from '../repositories/graded-attempt-repository';
import { SystemClock } from '../repositories/clock-repository';
import { incrementAndCheck } from '../repositories/rate-limit-repository';
import { getCandidate } from '../repositories/candidate-repository';
import { getEvidence, markEvidenceVerified } from '../repositories/evidence-repository';
import { fetchBadgeAssertion, fetchBadgeClass } from '../repositories/issuer-badge-repository';
import { fetchGist, fetchRepo, fetchRepoContributors } from '../repositories/github-repository';
import {
  consumeVerificationNonce,
  countVerificationAttempts,
  putVerificationNonce,
  recordVerificationAttempt,
} from '../repositories/verification-repository';
import { appendAuditEvent } from '../repositories/audit-event-repository';
import type { VerificationDependencies } from '../domain/verification-service';

/**
 * 128 bits of randomness, prefixed so a candidate pasting it into a public
 * gist can see what it is. The prefix is not a secret and carries no meaning
 * to the check; only the random part is compared.
 */
function generateNonce(): string {
  return `zoryvex-verify-${randomBytes(16).toString('hex')}`;
}

export function createAwsVerificationDependencies(): VerificationDependencies {
  return {
    checkRateLimit: incrementAndCheck,
    clock: new SystemClock(),
    getCandidate,
    getEvidence,
    fetchBadgeAssertion,
    fetchBadgeClass,
    markEvidenceVerified,
    countVerificationAttempts,
    recordVerificationAttempt,
    fetchGist,
    fetchRepo,
    fetchRepoContributors,
    putVerificationNonce,
    consumeVerificationNonce,
    generateNonce,
    appendAuditEvent,
    recordGradedAttempt,
    generateId: randomUUID,
  };
}
