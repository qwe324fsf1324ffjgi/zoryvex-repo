import { SystemClock } from '../repositories/clock-repository';
import { getCandidate, getCandidateIdByPublicProofId } from '../repositories/candidate-repository';
import { listCandidateEvidence } from '../repositories/evidence-repository';
import { listAttestationsForEvidence } from '../repositories/peer-attestation-repository';
import type { PublicProofDependencies } from '../domain/public-proof-service';

/**
 * Reads only. This composition root deliberately wires no write of any kind:
 * the two unauthenticated handlers that use it cannot change anything, which
 * is the property that makes an unauthenticated route safe to expose.
 */
export function createAwsPublicProofDependencies(): PublicProofDependencies {
  return {
    clock: new SystemClock(),
    getCandidateIdByPublicProofId,
    getCandidate,
    listCandidateEvidence,
    listAttestationsForEvidence,
  };
}
