import type {
  AuditEvent,
  Candidate,
  Employer,
  Entitlement,
  Evidence,
  KitOrder,
  LaunchTrack,
  Match,
  Role,
} from '@zoryvex/contracts';

/**
 * One method per access pattern in docs/DATA_MODEL.md — never a generic
 * "query everything and filter" escape hatch, so an implementation (local
 * or, later, a real DynamoDB-backed one) can't accidentally reintroduce a
 * scan. listDiscoveryOptedCandidates in particular must be structural
 * (only returns candidates currently opted in), matching the GSI1 design.
 */
export interface DataAdapter {
  getCandidate(id: string): Candidate | null;
  upsertCandidate(candidate: Candidate): void;
  deleteCandidate(id: string): void;

  listCandidateEvidence(candidateId: string): Evidence[];
  upsertEvidence(evidence: Evidence): void;
  deleteEvidence(candidateId: string, evidenceId: string): void;

  getEmployer(id: string): Employer | null;
  upsertEmployer(employer: Employer): void;

  /** Admin-only enumeration — maintained index, mirrors GSI3 (docs/DATA_MODEL.md). Never a scan. */
  listAllCandidates(): Candidate[];
  listAllEmployers(): Employer[];

  getEntitlement(employerId: string): Entitlement | null;
  upsertEntitlement(entitlement: Entitlement): void;

  /**
   * How many of the FOUNDING_SLOTS_TOTAL founding places have been taken.
   *
   * A counter rather than a count over entitlements, because the real
   * implementation must not scan: this is one item updated with an atomic
   * ADD, the same shape as the contact-unlock ledger (docs/DATA_MODEL.md).
   */
  countFoundingPlacesTaken(): number;

  /**
   * Record that this employer has taken a founding place. Idempotent per
   * employer: a replayed webhook, or a member who cancels and resubscribes,
   * must not consume a second place.
   */
  recordFoundingPlaceTaken(employerId: string): void;

  /**
   * Whether this employer already holds one of the founding places.
   *
   * A place belongs to the organization once claimed, and cancelling does
   * not release it. So a returning member must be quoted the founding price
   * even after the places are gone: their place is still counted against the
   * cap, and charging them standard would cost the founder a place and a
   * founding member at once.
   */
  holdsFoundingPlace(employerId: string): boolean;

  getRole(id: string): Role | null;
  listRolesByEmployer(employerId: string): Role[];
  upsertRole(role: Role): void;

  /** The Kit is purchased per role, not per employer. */
  getKitOrderForRole(roleId: string): KitOrder | null;
  listKitOrdersForEmployer(employerId: string): KitOrder[];
  upsertKitOrder(order: KitOrder): void;

  listMatchesForRole(roleId: string): Match[];
  /** Secondary index maintained on every upsertMatch — never a scan. */
  listMatchesForCandidate(candidateId: string): Match[];
  /** Direct key read — callers that write conditionally must re-fetch here, not trust a stale prop. */
  getMatch(roleId: string, candidateId: string): Match | null;
  upsertMatch(match: Match): void;

  /** Structural discovery query — mirrors GSI1 (docs/DATA_MODEL.md). */
  listDiscoveryOptedCandidates(track: LaunchTrack): Candidate[];

  /** Conditional put semantics — returns false if this event was already recorded. */
  recordWebhookEventOnce(eventId: string): boolean;

  appendAuditEvent(event: AuditEvent): void;
  listAuditEvents(): AuditEvent[];

  /** Full export of one candidate's own data — never another user's. */
  exportCandidateData(candidateId: string): { candidate: Candidate; evidence: Evidence[] } | null;
}
