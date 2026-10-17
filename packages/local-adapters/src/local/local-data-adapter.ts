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
import type { DataAdapter } from '../interfaces/data';
import { getJSON, setJSON, store } from './storage';

const candidateKey = (id: string) => `CANDIDATE#${id}#PROFILE`;
const evidencePrefix = (candidateId: string) => `CANDIDATE#${candidateId}#EVIDENCE#`;
const evidenceKey = (candidateId: string, evidenceId: string) =>
  `${evidencePrefix(candidateId)}${evidenceId}`;
const employerKey = (id: string) => `EMPLOYER#${id}#PROFILE`;
const entitlementKey = (employerId: string) => `EMPLOYER#${employerId}#ENTITLEMENT`;
const employerRoleIndexKey = (employerId: string) => `EMPLOYER#${employerId}#ROLE_IDS`;
const roleKey = (id: string) => `ROLE#${id}#PROFILE`;
const kitOrderKey = (roleId: string) => `ROLE#${roleId}#KIT_ORDER`;
const employerKitOrderIndexKey = (employerId: string) =>
  `EMPLOYER#${employerId}#KIT_ORDER_ROLE_IDS`;
const matchPrefix = (roleId: string) => `ROLE#${roleId}#MATCH#`;
const candidateMatchIndexKey = (candidateId: string) => `CANDIDATE#${candidateId}#MATCH_IDS`;
const matchKey = (roleId: string, candidateId: string) => `${matchPrefix(roleId)}${candidateId}`;
const webhookKey = (eventId: string) => `WEBHOOK#${eventId}#EVENT`;
const discoveryIndexKey = (track: LaunchTrack) => `INDEX#DISCOVERY#${track}`;
const auditPrefix = 'AUDIT#';
const auditKey = (id: string) => `${auditPrefix}${id}`;
/**
 * Admin-only enumeration indexes (mirrors GSI3 — see docs/DATA_MODEL.md).
 * Never a raw prefix scan over CANDIDATE#/EMPLOYER# keys, which would also
 * pick up evidence/match/kit-order sub-items — a maintained index queried
 * the same way GSI1 (discovery) already is.
 */
const ALL_CANDIDATES_INDEX_KEY = 'INDEX#ALL_CANDIDATES';
const ALL_EMPLOYERS_INDEX_KEY = 'INDEX#ALL_EMPLOYERS';

// One item holding the founding-place count, plus the set of employers that
// have taken one. The set is what makes recordFoundingPlaceTaken idempotent:
// without it a replayed webhook would burn a place, and there are only
// twenty-five.
const FOUNDING_PLACES_KEY = 'LEDGER#FOUNDING_PLACES';

export class LocalDataAdapter implements DataAdapter {
  getCandidate(id: string): Candidate | null {
    return getJSON<Candidate>(candidateKey(id));
  }

  upsertCandidate(candidate: Candidate): void {
    const previous = this.getCandidate(candidate.id);
    setJSON(candidateKey(candidate.id), candidate);
    this.reindexDiscovery(previous, candidate);
    if (!previous) {
      const ids = new Set(getJSON<string[]>(ALL_CANDIDATES_INDEX_KEY) ?? []);
      ids.add(candidate.id);
      setJSON(ALL_CANDIDATES_INDEX_KEY, [...ids]);
    }
  }

  deleteCandidate(id: string): void {
    const existing = this.getCandidate(id);
    if (existing) this.reindexDiscovery(existing, null);
    store.delete(candidateKey(id));
    for (const key of store.keys(evidencePrefix(id))) store.delete(key);
    const ids = new Set(getJSON<string[]>(ALL_CANDIDATES_INDEX_KEY) ?? []);
    ids.delete(id);
    setJSON(ALL_CANDIDATES_INDEX_KEY, [...ids]);
  }

  /** Admin-only enumeration — see the GSI3 note on ALL_CANDIDATES_INDEX_KEY above. */
  listAllCandidates(): Candidate[] {
    const ids = getJSON<string[]>(ALL_CANDIDATES_INDEX_KEY) ?? [];
    return ids.map((id) => this.getCandidate(id)).filter((c): c is Candidate => c !== null);
  }

  private reindexDiscovery(previous: Candidate | null, next: Candidate | null): void {
    if (previous && previous.discoveryOptIn) {
      this.removeFromDiscoveryIndex(previous.launchTrack, previous.id);
    }
    if (next && next.discoveryOptIn) {
      this.addToDiscoveryIndex(next.launchTrack, next.id);
    }
  }

  private addToDiscoveryIndex(track: LaunchTrack, candidateId: string): void {
    const ids = new Set(getJSON<string[]>(discoveryIndexKey(track)) ?? []);
    ids.add(candidateId);
    setJSON(discoveryIndexKey(track), [...ids]);
  }

  private removeFromDiscoveryIndex(track: LaunchTrack, candidateId: string): void {
    const ids = new Set(getJSON<string[]>(discoveryIndexKey(track)) ?? []);
    ids.delete(candidateId);
    setJSON(discoveryIndexKey(track), [...ids]);
  }

  listDiscoveryOptedCandidates(track: LaunchTrack): Candidate[] {
    const ids = getJSON<string[]>(discoveryIndexKey(track)) ?? [];
    return ids
      .map((id) => this.getCandidate(id))
      .filter((c): c is Candidate => c !== null && c.discoveryOptIn);
  }

  listCandidateEvidence(candidateId: string): Evidence[] {
    return store
      .keys(evidencePrefix(candidateId))
      .map((key) => getJSON<Evidence>(key))
      .filter((e): e is Evidence => e !== null)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  upsertEvidence(evidence: Evidence): void {
    setJSON(evidenceKey(evidence.candidateId, evidence.id), evidence);
  }

  deleteEvidence(candidateId: string, evidenceId: string): void {
    store.delete(evidenceKey(candidateId, evidenceId));
  }

  getEmployer(id: string): Employer | null {
    return getJSON<Employer>(employerKey(id));
  }

  upsertEmployer(employer: Employer): void {
    const isNew = this.getEmployer(employer.id) === null;
    setJSON(employerKey(employer.id), employer);
    if (isNew) {
      const ids = new Set(getJSON<string[]>(ALL_EMPLOYERS_INDEX_KEY) ?? []);
      ids.add(employer.id);
      setJSON(ALL_EMPLOYERS_INDEX_KEY, [...ids]);
    }
  }

  /** Admin-only enumeration — see the GSI3 note on ALL_CANDIDATES_INDEX_KEY above. */
  listAllEmployers(): Employer[] {
    const ids = getJSON<string[]>(ALL_EMPLOYERS_INDEX_KEY) ?? [];
    return ids.map((id) => this.getEmployer(id)).filter((e): e is Employer => e !== null);
  }

  getEntitlement(employerId: string): Entitlement | null {
    return getJSON<Entitlement>(entitlementKey(employerId));
  }

  upsertEntitlement(entitlement: Entitlement): void {
    setJSON(entitlementKey(entitlement.employerId), entitlement);
  }

  countFoundingPlacesTaken(): number {
    return this.foundingPlaceHolders().length;
  }

  recordFoundingPlaceTaken(employerId: string): void {
    const holders = this.foundingPlaceHolders();
    if (holders.includes(employerId)) return;
    setJSON(FOUNDING_PLACES_KEY, [...holders, employerId]);
  }

  holdsFoundingPlace(employerId: string): boolean {
    return this.foundingPlaceHolders().includes(employerId);
  }

  private foundingPlaceHolders(): string[] {
    return getJSON<string[]>(FOUNDING_PLACES_KEY) ?? [];
  }

  getRole(id: string): Role | null {
    return getJSON<Role>(roleKey(id));
  }

  listRolesByEmployer(employerId: string): Role[] {
    const ids = getJSON<string[]>(employerRoleIndexKey(employerId)) ?? [];
    return ids.map((id) => this.getRole(id)).filter((r): r is Role => r !== null);
  }

  upsertRole(role: Role): void {
    setJSON(roleKey(role.id), role);
    const ids = new Set(getJSON<string[]>(employerRoleIndexKey(role.employerId)) ?? []);
    ids.add(role.id);
    setJSON(employerRoleIndexKey(role.employerId), [...ids]);
  }

  getKitOrderForRole(roleId: string): KitOrder | null {
    return getJSON<KitOrder>(kitOrderKey(roleId));
  }

  listKitOrdersForEmployer(employerId: string): KitOrder[] {
    const roleIds = getJSON<string[]>(employerKitOrderIndexKey(employerId)) ?? [];
    return roleIds
      .map((roleId) => this.getKitOrderForRole(roleId))
      .filter((o): o is KitOrder => o !== null);
  }

  upsertKitOrder(order: KitOrder): void {
    setJSON(kitOrderKey(order.roleId), order);
    const ids = new Set(getJSON<string[]>(employerKitOrderIndexKey(order.employerId)) ?? []);
    ids.add(order.roleId);
    setJSON(employerKitOrderIndexKey(order.employerId), [...ids]);
  }

  listMatchesForRole(roleId: string): Match[] {
    return store
      .keys(matchPrefix(roleId))
      .map((key) => getJSON<Match>(key))
      .filter((m): m is Match => m !== null);
  }

  listMatchesForCandidate(candidateId: string): Match[] {
    const ids = getJSON<string[]>(candidateMatchIndexKey(candidateId)) ?? [];
    return ids
      .map((roleId) => getJSON<Match>(matchKey(roleId, candidateId)))
      .filter((m): m is Match => m !== null);
  }

  getMatch(roleId: string, candidateId: string): Match | null {
    return getJSON<Match>(matchKey(roleId, candidateId));
  }

  upsertMatch(match: Match): void {
    setJSON(matchKey(match.roleId, match.candidateId), match);
    const ids = new Set(getJSON<string[]>(candidateMatchIndexKey(match.candidateId)) ?? []);
    ids.add(match.roleId);
    setJSON(candidateMatchIndexKey(match.candidateId), [...ids]);
  }

  recordWebhookEventOnce(eventId: string): boolean {
    const key = webhookKey(eventId);
    if (store.get(key) !== null) return false;
    setJSON(key, { eventId, recordedAt: new Date().toISOString() });
    return true;
  }

  appendAuditEvent(event: AuditEvent): void {
    setJSON(auditKey(event.id), event);
  }

  listAuditEvents(): AuditEvent[] {
    return store
      .keys(auditPrefix)
      .map((key) => getJSON<AuditEvent>(key))
      .filter((e): e is AuditEvent => e !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  exportCandidateData(candidateId: string): { candidate: Candidate; evidence: Evidence[] } | null {
    const candidate = this.getCandidate(candidateId);
    if (!candidate) return null;
    return { candidate, evidence: this.listCandidateEvidence(candidateId) };
  }
}
