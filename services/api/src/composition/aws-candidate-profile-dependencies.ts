import { SystemClock } from '../repositories/clock-repository';
import { getCandidate, updateCandidateProfile } from '../repositories/candidate-repository';
import type { CandidateProfileDependencies } from '../domain/candidate-profile-service';

export function createAwsCandidateProfileDependencies(): CandidateProfileDependencies {
  return { clock: new SystemClock(), getCandidate, updateCandidateProfile };
}
