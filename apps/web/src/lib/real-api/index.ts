export { apiRequest, apiRequestRawText, isRealApiConfigured, RealApiError } from './client';
export { messageFor } from './error-message';
export * as realAuth from './auth';
export * as realRoles from './roles';
export * as realCandidateProfile from './candidate-profile';
export * as realEvidenceClaims from './evidence-claims';
export type {
  RepoVerificationChallenge,
  VerificationProof,
  VerificationResult,
} from './evidence-claims';
/*
  `evidence-files` is deliberately not exported here any more.

  Uploading a file to a claim was removed on 2026-09-09 (founder instruction),
  so nothing in the app should be able to reach the upload client by accident.
  The module and its test stay, because the server pipeline they talk to also
  stays until its Terraform destroy is approved, and the two should be deleted
  together rather than half now and half later.
*/
export * as realKit from './kit';
export * as realPrivacy from './privacy';
export * as realPublicProof from './public-proof';
export * as realMatches from './matches';
export * as realCandidateMatches from './candidate-matches';
export type { CandidateMatchView } from './candidate-matches';
export type { UnlockedContactInfo, VerifiedEvidenceSummary } from './matches';
export * as realAdmin from './admin';
export * as realBilling from './billing';
export * as realAdminBilling from './admin-billing';
export type { AdminBillingDiagnostic, BillingTimelineEntry } from './admin-billing';
export type { BillingSnapshot, SubscriptionQuote } from './billing';
