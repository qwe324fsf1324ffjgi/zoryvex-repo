import { SystemClock } from '../repositories/clock-repository';
import { listAttestationsForEvidence } from '../repositories/peer-attestation-repository';
import {
  createEvidence,
  deleteEvidence,
  getEvidence,
  getEvidenceWithVersion,
  listCandidateEvidence,
  updateEvidence,
} from '../repositories/evidence-repository';
import type { EvidenceClaimDependencies } from '../domain/evidence-claim-service';

export function createAwsEvidenceClaimDependencies(): EvidenceClaimDependencies {
  return {
    clock: new SystemClock(),
    createEvidence,
    getEvidence,
    getEvidenceWithVersion,
    listAttestationsForEvidence,
    listCandidateEvidence,
    updateEvidence,
    deleteEvidence,
  };
}
