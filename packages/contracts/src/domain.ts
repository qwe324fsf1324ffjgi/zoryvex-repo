import { z } from 'zod';
import {
  CandidateIntentSchema,
  EngagementKindSchema,
  InterestStateSchema,
  RoleIntentSchema,
} from './intent';
import { EvidenceStrengthLevelSchema, EvidenceStrengthSchema } from './evidence-strength';
import { PeerRelationshipSchema } from './peer-attestation';

/**
 * Domain schemas shared by services/api's future real repositories and
 * packages/local-adapters' deterministic local implementations, so both
 * agree on shape. Keys mirror docs/DATA_MODEL.md's PK/SK design.
 */

export const LaunchTrackSchema = z.enum([
  'aws_cloud',
  'devops_platform',
  'cloud_security',
  'mlops',
]);
export type LaunchTrack = z.infer<typeof LaunchTrackSchema>;

export const LAUNCH_TRACK_LABELS: Record<LaunchTrack, string> = {
  aws_cloud: 'Cloud engineering',
  devops_platform: 'DevOps/platform',
  cloud_security: 'Cloud-security/DevSecOps',
  mlops: 'MLOps/ML platform',
};

export const EvidenceVerificationStateSchema = z.enum(['unverified', 'self_attested', 'verified']);
/**
 * Who can see a piece of evidence.
 *
 * `employer_shared` is kept so records already written still parse, and it is
 * treated exactly as `discovery` is — which it always was. Every filter in
 * apps/web and services/api reads `visibility !== 'private'`, so the two
 * shared levels have never behaved differently.
 *
 * The candidate-facing label for it was "Shared with an employer I apply to",
 * which described a narrower disclosure than actually happened and an action
 * the product does not support: there is no application entity and no apply
 * flow anywhere. A candidate who picked it to withhold something until they
 * chose to apply had it shown to every employer whose role they matched. It
 * is no longer offered.
 */
export const EvidenceVisibilitySchema = z.enum(['private', 'discovery', 'employer_shared']);

/** What each level actually means, in the candidate's terms. */
export const EVIDENCE_VISIBILITY_LABELS: Record<
  z.infer<typeof EvidenceVisibilitySchema>,
  string
> = {
  private: 'private',
  discovery: 'visible to matched employers',
  employer_shared: 'visible to matched employers',
};

/**
 * Every way a claim can become `verified` on this platform. All three are
 * autonomous: a machine re-runnable check against a source the candidate
 * does not control the answer of. There is deliberately no "an admin said
 * so" method — a human judgement is not reproducible, cannot be re-run when
 * a credential expires, and does not scale, which is the whole reason the
 * verification states existed for months with nothing able to set them.
 *
 * - `issuer_badge`: an Open Badges assertion from a recognized issuer (AWS
 *   certifications via Credly). The recipient identity is a salted hash of
 *   the holder's email, so this cryptographically binds the credential to
 *   the candidate's own verified address.
 * - `repo_ownership`: control of a public repository proven by publishing a
 *   one-time nonce, plus deterministic facts read from the repository.
 * - `graded_task`: a time-boxed practical task scored by a deterministic
 *   rubric, never by a model's opinion.
 */
export const VerificationMethodSchema = z.enum(['issuer_badge', 'repo_ownership', 'graded_task']);
export type VerificationMethod = z.infer<typeof VerificationMethodSchema>;

/**
 * The one check each kind of claim is eligible for.
 *
 * These were two unrelated choices until now. A candidate picked what the
 * claim was about when they filed it, picked how to prove it when they
 * verified it, and nothing required the two to agree — so a claim filed as
 * "GitHub / code repository" could be marked verified by a certification
 * badge, and a claim filed as "Certification" by a repository. The stored
 * evidence then said one thing and the check behind it said another, which
 * is exactly the arbitrariness this product exists to refuse.
 *
 * So the claim's kind decides the check, and nothing else does. A
 * certification is confirmed with the body that issued it. Code is confirmed
 * by proving the account and reading the repository. Both are machine
 * re-runnable against a source the candidate does not control, which is the
 * whole definition of verified here.
 *
 * `null` is a deliberate answer, not a gap. A project write-up, a blog post
 * or anything filed as "other" has no source outside the candidate to check
 * it against — there is nobody to ask and nothing to re-run. Those claims can
 * still be confirmed by a colleague who was there
 * (services/api/src/domain/peer-request-service.ts), which is recorded as
 * that person's word rather than as a check, and is shown to employers as
 * such. Offering a machine check for them would be inventing one.
 */
export const VERIFICATION_METHOD_FOR_SOURCE: Record<
  EvidenceSource,
  // `graded_task` is excluded at the type level, not merely absent from the
  // table below. The enum still carries it so evidence verified that way
  // before the decision keeps parsing and keeps reading honestly, but nothing
  // can be verified that way again, and a future edit that tried would not
  // compile.
  Exclude<VerificationMethod, 'graded_task'> | null
> = {
  certification: 'issuer_badge',
  github: 'repo_ownership',
  project: null,
  writeup: null,
  other: null,
};

/**
 * What kind of thing a claim is about.
 *
 * Named rather than left inline because it now decides something: which
 * check a claim is eligible for. See VERIFICATION_METHOD_FOR_SOURCE below.
 */
export const EvidenceSourceSchema = z.enum([
  'github',
  'project',
  'writeup',
  'certification',
  'other',
]);
export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;

/**
 * How each kind reads inside a sentence, so a refusal can name what the
 * candidate actually filed rather than echoing a storage value at them.
 */
export const EVIDENCE_SOURCE_LABELS: Record<EvidenceSource, string> = {
  github: 'code repository',
  project: 'project write-up',
  writeup: 'blog post or write-up',
  certification: 'certification',
  other: 'claim of this kind',
};

export const EvidenceSchema = z.object({
  id: z.string(),
  candidateId: z.string(),
  source: EvidenceSourceSchema,
  claim: z.string().min(1),
  context: z.string().min(1),
  actions: z.string().min(1),
  outcome: z.string().min(1),
  verificationState: EvidenceVerificationStateSchema,
  /**
   * How this item reached `verified`, set only by
   * services/api/src/domain/verification-service.ts and never by a client.
   * Absent whenever verificationState is not `verified`.
   */
  verificationMethod: VerificationMethodSchema.optional(),
  verifiedAt: z.string().datetime().optional(),
  /**
   * The public identifier the check was run against — a badge assertion id,
   * a repository full name. Deliberately never a secret and never a URL with
   * a token in it: it exists so a verification can be re-run or audited, and
   * so an employer can be told what was actually checked.
   */
  verificationRef: z.string().optional(),
  /**
   * What was actually checked, in words an employer can read — "AWS
   * Certified Solutions Architect, confirmed with Amazon Web Services
   * Training and Certification", or "you/your-repo, a public repository with
   * 84 commits credited to them".
   *
   * Stored because `verificationRef` alone is not legible: a badge reference
   * is an opaque UUID, and an employer paying for proof should not be handed
   * a database key and asked to trust it.
   */
  verificationDetail: z.string().optional(),
  /**
   * When the underlying credential stops being current, if it ever does.
   *
   * Verification is a claim about a moment, and certifications lapse. The
   * verifier already read this date to refuse an expired badge and then
   * discarded it, so an AWS certification verified today stayed marked
   * `verified` for ever — including years after it expired. An employer
   * clicking "check this yourself at the source" would have found the
   * expiry themselves, which is the worst possible way for a platform that
   * sells trust to be caught making a stale claim.
   *
   * Absent means the credential does not expire (a repository, a
   * perpetual badge), which is different from "expiry unknown" and is
   * treated as still current.
   */
  verificationExpiresAt: z.string().datetime().optional(),
  visibility: EvidenceVisibilitySchema,
  consentGiven: z.boolean(),
  /** Exactly one of sourceUrl/fileId, or neither for a text-only entry. */
  sourceUrl: z.string().url().optional(),
  fileId: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

/**
 * Where a candidate works from. Stated by them, on their own profile, and
 * never inferred from an IP address, a phone prefix, a name, or anything
 * else. Location filtering is legitimate because payroll and working hours
 * are real constraints; inferring it would turn a filter into a proxy for
 * nationality, which CLAUDE.md forbids outright.
 *
 * Two fields, because two things actually constrain remote hiring: where an
 * employer is able to employ and pay someone, and how far apart the working
 * days are. City is deliberately absent. These are remote cloud roles, and a
 * city would collect more personal data than any decision here needs.
 */
export const CandidateLocationSchema = z.object({
  /** ISO 3166-1 alpha-2, uppercase. */
  country: z.string().regex(/^[A-Z]{2}$/, 'Country must be a two-letter code like NG or KE'),
  /** Standard UTC offsets run from -12:00 to +14:00. */
  utcOffsetMinutes: z.number().int().min(-720).max(840),
});
export type CandidateLocation = z.infer<typeof CandidateLocationSchema>;

/**
 * What a role requires of a candidate's location.
 *
 * Both dimensions are opt-in: an empty country list means anywhere, and a
 * null timezone limit means any offset. A role with neither set filters
 * nobody, which is the state every existing role is in.
 */
export const RoleLocationRequirementSchema = z.object({
  /** Empty means anywhere. Non-empty is an allow-list, never a deny-list. */
  countries: z
    .array(z.string().regex(/^[A-Z]{2}$/, 'Country must be a two-letter code like NG or KE'))
    .max(20)
    .default([]),
  /**
   * The role's own working offset, which the difference below is measured
   * from. Required whenever a requirement exists, because a difference needs
   * something to be different from.
   */
  utcOffsetMinutes: z.number().int().min(-720).max(840),
  /** Null means no timezone limit. Zero means the same offset exactly. */
  maxTimezoneDifferenceHours: z.number().min(0).max(12).nullable().default(null),
});
export type RoleLocationRequirement = z.infer<typeof RoleLocationRequirementSchema>;

/**
 * A phone number, kept deliberately permissive.
 *
 * Zoryvex launches in Nigeria and expects international numbers, and a
 * strict national format would reject correct numbers from people it wants.
 * What is enforced is only what a wrong value looks like: it must start with
 * a digit or `+`, contain nothing but digits and the ordinary separators, and
 * be a plausible length. Anything tighter is a rule about formatting rather
 * than about reachability, and rejecting a real number to enforce a
 * preferred punctuation is a bad trade.
 */
export const PhoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9\s()+-]{5,24}$/, 'That does not look like a phone number.');

/**
 * A LinkedIn profile URL, and only that.
 *
 * Constrained to the one host and the profile path on purpose. An
 * unconstrained URL field on a record that gets shown to an employer is a
 * place to put anything — a redirect, a tracker, a page that changes after
 * the check — and the field claims to be a LinkedIn profile, so it should be
 * one. A candidate who wants to share something else has evidence for that,
 * which gets verified.
 */
export const LinkedInUrlSchema = z
  .string()
  .trim()
  .regex(
    /^https:\/\/(www\.)?linkedin\.com\/in\/[A-Za-z0-9\-_%]{1,100}\/?$/,
    'Use the full address of your LinkedIn profile, like https://www.linkedin.com/in/your-name',
  );

/**
 * One more link, for the people whose work does not live on LinkedIn.
 *
 * `LinkedInUrlSchema` above is pinned to one host on purpose, and that
 * reasoning still holds for a field that claims to be a LinkedIn profile.
 * But plenty of engineers are reachable at a GitHub profile, a personal
 * site, or somewhere else entirely, and refusing all of them to avoid an
 * unconstrained field made the product quieter about people rather than
 * safer.
 *
 * So the constraint moved rather than disappeared. What is enforced is what
 * makes a link dangerous rather than merely unfamiliar: https only, no
 * embedded credentials, a real host, and a bounded length. What is NOT
 * enforced is which host it is, because that was the part doing the
 * excluding.
 *
 * The rest is handled by saying so. An employer is shown this as a link the
 * candidate gave and Zoryvex has not checked, in the same words peer
 * confirmations already carry. A product that shows an unverified thing and
 * labels it unverified is being honest; one that hides it is being quiet.
 */
export const ProfileLinkSchema = z
  .string()
  .trim()
  .max(200, 'That link is too long.')
  .refine((value) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return false;
    }
    if (parsed.protocol !== 'https:') return false;
    // user:password@host is the shape used to make a link look like it goes
    // somewhere it does not.
    if (parsed.username || parsed.password) return false;
    return parsed.hostname.includes('.');
  }, 'Use a full web address starting with https://, like https://github.com/your-name');

export const CandidateSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  displayName: z.string().min(1),
  launchTrack: LaunchTrackSchema,
  discoveryOptIn: z.boolean(),
  /**
   * Explicit, reversible consent to contact info being shared with an
   * employer once they complete a server-side unlock transaction — never
   * assumed. Optional (not `.default()`) so existing object literals typed
   * as `Candidate` (packages/local-adapters fixtures) keep compiling;
   * `undefined` is always treated as "not consented", the safe default.
   */
  contactUnlockConsent: z.boolean().optional(),
  /**
   * Other ways to reach this person, if they chose to give any.
   *
   * Optional in the strongest sense: a candidate who gives neither is not
   * penalised anywhere. They are never used in matching, never scored, never
   * shown on a public proof page, and never included in anything a model
   * reads. They exist for one moment only — after an employer has unlocked
   * contact and while consent still stands — and they travel through exactly
   * the same gate the email address does, re-checked on every disclosure.
   *
   * The reason to have them at all is that an email address is one channel,
   * and a candidate who would rather be reached on LinkedIn or by phone
   * currently has no way to say so. Making the employer guess, or making the
   * candidate paste a number into a summary field where it would be public,
   * are both worse than modelling it.
   */
  phone: PhoneSchema.optional(),
  linkedinUrl: LinkedInUrlSchema.optional(),
  /**
   * Anywhere else they would rather be found. Released to an employer under
   * exactly the same conditions as the phone number and the LinkedIn URL,
   * and never before an unlock.
   */
  websiteUrl: ProfileLinkSchema.optional(),
  /**
   * A photo the candidate chose to put on their own pages.
   *
   * The id of one of their own uploaded files, which means it has already
   * been through the quarantine, malware scan and metadata strip that every
   * upload goes through. It is not a second storage path.
   *
   * Where it appears is the substance of this field, and the limit is
   * deliberate. It shows on the candidate's own profile and, if they turn
   * one on, their public proof page — pages they own and choose to share. It
   * never appears in an employer's shortlist, on a match card, or beside a
   * score, and no employer-facing shape carries it.
   *
   * The reason is the product's own rule that nothing may infer protected
   * traits or score faces. A photograph next to a ranked list is the
   * ordinary way demographic bias enters screening, and it would arrive
   * here disguised as a nicety. A candidate can still put their face on the
   * page they send to people, which is theirs to decide; what they cannot do
   * is have it sitting next to a number an employer is sorting on.
   */
  /**
   * Optional for the same reason as contactUnlockConsent, and for one more:
   * every candidate who existed before 2026-09-01 has none. A missing
   * location never excludes anybody. Excluding someone for leaving blank a
   * field that did not exist when they signed up would be a silent
   * rejection, which is the one thing matching must never do.
   */
  location: CandidateLocationSchema.optional(),
  /**
   * The opaque id in this candidate's public proof URL, present only while
   * they consent to having one.
   *
   * Separate from `id` on purpose. A public URL built from the internal id
   * would be permanent: revoking consent could hide the page but never
   * un-share a link somebody had already saved. This is minted on opt-in and
   * destroyed on opt-out, so revoking really does break every link that ever
   * existed, and opting back in issues a different one.
   */
  publicProofId: z.string().optional(),
  /**
   * What this person is open to and what they need to be paid.
   *
   * Optional for the same reason as the role's: absent means unstated, and
   * matching reads an unstated preference as no constraint rather than as
   * a refusal.
   */
  intent: CandidateIntentSchema.optional(),
  onboardingComplete: z.boolean(),
  summary: z.string().default(''),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Candidate = z.infer<typeof CandidateSchema>;

/**
 * What a stranger sees at a candidate's public proof URL.
 *
 * This is the only shape in the product that leaves the authenticated
 * boundary, so it is defined by what it omits as much as by what it carries.
 * Absent, deliberately and permanently: the email address, the internal
 * candidate id, contact details of any kind, unverified or self-attested
 * claims, anything whose visibility is private, and the candidate's own
 * narrative of context and actions. A public page is proof, not a CV.
 *
 * Every entry is a claim that passed a machine-re-runnable check against a
 * source the candidate does not control, and each carries the two dates that
 * make it honest: when it was checked, and when it stops being true.
 */
export const PublicProofEntrySchema = z.object({
  claim: z.string().min(1),
  verificationMethod: VerificationMethodSchema,
  /**
   * What was actually checked, in words an employer can read. Same name as
   * the field it comes from on Evidence, deliberately: a public shape that
   * renamed it would add a translation layer for nothing and cost somebody
   * an afternoon later.
   */
  verificationDetail: z.string().min(1),
  verifiedAt: z.string().datetime(),
  /** Absent means the credential behind it does not lapse. */
  verificationExpiresAt: z.string().datetime().optional(),
  /**
   * What this proof establishes, and what Zoryvex cannot establish at all.
   *
   * On the public page because this is the one surface read by somebody with
   * no account, no context, and no reason to extend credit. "Verified" alone
   * asks them to take a word for it, which is the thing this product exists
   * to refuse.
   */
  strength: EvidenceStrengthSchema,
  /**
   * Confirmations from people who worked with them, in their own words.
   *
   * Public because the verifier is told so before they write it, on the
   * confirm page itself, rather than after. Carries the organisation's domain
   * and never the person's address. Attributed as testimony, which is what
   * the strength model already prices it as.
   */
  peerAttestations: z.array(
    z.object({
      verifierDomain: z.string().min(3),
      relationship: PeerRelationshipSchema,
      statement: z.string().min(1),
      confirmedAt: z.string().datetime(),
    }),
  ),
});
export type PublicProofEntry = z.infer<typeof PublicProofEntrySchema>;

export const PublicProofSchema = z.object({
  displayName: z.string().min(1),
  launchTrack: LaunchTrackSchema,
  proofs: z.array(PublicProofEntrySchema),
  /**
   * When this page was built, not when anything was verified. It is here so
   * the page can say how fresh it is, because a proof page that cannot date
   * itself is asking to be trusted.
   */
  generatedAt: z.string().datetime(),
});
export type PublicProof = z.infer<typeof PublicProofSchema>;

export const EmployerSchema = z.object({
  id: z.string(),
  organizationName: z.string().min(1),
  contactEmail: z.string().email(),
  createdAt: z.string().datetime(),
});
export type Employer = z.infer<typeof EmployerSchema>;

export const EntitlementPlanSchema = z.enum(['none', 'kit', 'scout', 'team', 'partner']);
export type EntitlementPlan = z.infer<typeof EntitlementPlanSchema>;

/**
 * Illustrative monthly contact-unlock allowance per plan — not a real
 * billing model (CLAUDE.md's founding prices are fixed; per-tier allowance
 * numbers are an internal product decision, not yet contractually fixed).
 * Single source of truth for both apps/web's local-adapter-driven UI and
 * services/api's real, atomically-enforced unlock transaction.
 */
export const CONTACT_UNLOCK_ALLOWANCE: Record<EntitlementPlan, number> = {
  none: 0,
  kit: 0,
  scout: 5,
  team: 15,
  partner: 50,
};
/**
 * How many real, discovery-opted matches a role needs before its marketplace
 * opens.
 *
 * docs/COMMERCIAL_RUNBOOK.md: "No recurring marketplace promotion for a saved
 * role until >= 5 real, opted-in matching candidates exist and the
 * eligibility check passes server-side." The number lived only in
 * apps/web's role page, so the gate was a rule the browser applied and the
 * server did not — the opposite of what that sentence requires.
 *
 * Lowered from 5 to 1 on 2026-09-02 by founder decision, with the honesty
 * requirement moved rather than dropped: an employer may now subscribe
 * against a single matching candidate, and must be told the real number
 * before they pay. See docs/DECISIONS.md.
 *
 * One rather than zero, deliberately. A marketplace with one person in it is
 * a thin product an informed buyer may still want, because the Kit and the
 * verification work regardless of marketplace size. A marketplace with nobody
 * in it is not a product at all, and selling it would be the refund this gate
 * was built to prevent.
 *
 * The disclosure is what makes the lower number defensible, so it is not
 * optional decoration: quoteSubscription carries the true count, and the
 * checkout surface states it. Take the disclosure away and this constant
 * should go back to 5.
 */
export const MARKETPLACE_GATE_MIN_MATCHES = 1;

/**
 * How many pieces of evidence one candidate may file.
 *
 * Unbounded until 2026-09-04, and the cost of that was not storage. Three
 * things multiply by this number:
 *
 * - Matching scores every role requirement against every piece of a
 *   candidate's evidence. `mustHaveWork` was capped at twenty on the same
 *   day; this is the other multiplicand, and capping one without the other
 *   leaves the product unbounded.
 * - Verification allows five attempts per evidence item against an issuer's
 *   API. GitHub's unauthenticated limit is sixty an hour and is shared by
 *   everybody, so unlimited items times five attempts is a way for one
 *   account to stop verification working for every other candidate.
 * - The data export reads attempts per evidence item, so one request grows
 *   with this number too.
 *
 * Fifty is far above what the product is for. A person presenting proof of
 * their work has a handful of things worth checking, not fifty, so this
 * bounds abuse without being a limit anybody honest will meet. It is a
 * quota rather than a validation rule: the refusal says what to do, which
 * is delete something rather than write less.
 */
export const MAX_EVIDENCE_PER_CANDIDATE = 50;

export const EntitlementStatusSchema = z.enum(['none', 'active', 'past_due', 'canceled']);
export type EntitlementStatus = z.infer<typeof EntitlementStatusSchema>;

/**
 * Founding places, and what a subscription costs.
 *
 * Both prices are founder-fixed (CLAUDE.md): founding is what the first
 * FOUNDING_SLOTS_TOTAL organizations pay, standard is what everyone after
 * them pays, and the two are the same product — founding buys a lower price,
 * never extra features.
 *
 * This lives in contracts rather than in apps/web because the site was not
 * the only thing that knew a price. `local-payments-adapter` carried its own
 * copy of the three founding prices, so the page and the charge were two
 * numbers that had to agree with nothing able to notice when they stopped —
 * the same defect already fixed for the Kit, one field over.
 *
 * The standard prices had no copy anywhere. Nothing selected them, so every
 * organization was charged the founding price, forever, while the pricing
 * page said the twenty-fifth organization was the last to get it. That is the
 * sentence this code makes true.
 *
 * Reduced from 25 to 5 on 2026-09-02 by founder decision. Nobody holds a
 * founding place yet, so no existing customer's price changes and no promise
 * already made to a buyer is broken. Every surface derives the number from
 * this constant, which is what makes a change of this kind a one-line edit
 * rather than a hunt through copy.
 */
export const FOUNDING_SLOTS_TOTAL = 5;

export const SUBSCRIPTION_PLANS = ['scout', 'team', 'partner'] as const;
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

/**
 * Standard raised 2026-09-01, founder-approved: Scout 185,000 to 250,000,
 * Team 520,000 to 700,000, Partner 1,350,000 to 5,000,000. Founding was
 * deliberately not touched, for the second time.
 *
 * Raising standard alone is what makes a founding place worth having. The
 * discount goes from a little over half to about two thirds on Scout and
 * Team, and to 88% on Partner, and the only real scarcity this product has
 * is that there are twenty-five places. Raising both would have moved the
 * number a founding member locks in for life, which is the strongest
 * promise on the pricing page.
 *
 * Partner is deliberately a different shape from the other two. Scout to
 * Team is 2.8x and Team to Partner is 7x, which makes standard Partner an
 * enterprise step rather than the next rung of a ladder. That is a founder
 * decision recorded in docs/DECISIONS.md, not an arithmetic accident, and
 * it is why the copy must never describe the three as evenly spaced.
 *
 * It cost nothing to do now and would not have been free later: nobody has
 * subscribed, no Paystack Plan object exists yet, and a Plan's amount is
 * fixed once created. The same change after a customer is attached to a
 * Plan is six new Plan objects and a migration.
 *
 * Doubled again on 2026-09-04, on the founder's instruction to make the
 * subscriptions considerably more expensive. Every price is exactly twice
 * what it was, which is the only way to raise them all without rewriting
 * the model around them: the founding discount stays at roughly two fifths
 * on Scout and Team and four fifths on Partner, Partner keeps its
 * deliberately different enterprise shape, and the two sets still
 * interleave the same way - founding Scout (300,000) below standard Scout
 * (500,000) below founding Team (800,000), so a founding Team buyer still
 * pays more than a standard Scout buyer.
 *
 * Still free to do: nobody has subscribed. The six Paystack Plan objects
 * carrying the previous amounts cannot be edited, so six new ones were
 * created and the plan-code parameter repointed at them. The superseded
 * Plans stay in the account and are unreachable, because a plan is only
 * ever selected by code from that parameter, never by name.
 *
 * Standard Partner came back down from 10,000,000 to 4,000,000 the same
 * day, on the founder's instruction to make it a price Paystack can
 * actually take while keeping it high. The doubling had put one charge
 * above the account's entire NGN 8,000,000 lifetime collection limit, so
 * the tier could not take a first payment at all.
 *
 * 4,000,000 is the highest price at which a renewal still fits: two charges
 * against the ceiling rather than one. Every figure above 4,000,000 leaves
 * room for the first payment and none for the second, which is the same
 * failure the 5,000,000 price had and the reason this moved.
 *
 * Two consequences worth stating rather than discovering. The founding
 * discount on Partner drops from about four fifths to about a half, which
 * puts it alongside Scout's two fifths and Team's rather than far outside
 * them - more coherent than it was. And the ladder is no longer the shape
 * the 2026-08-30 decision described: Scout to Team is 2.8x and Team to
 * Partner is 2.86x, so at standard prices the three tiers are now close to
 * evenly spaced. Copy must stop calling Partner a different shape from the
 * other two, because it no longer is.
 */
/**
 * Raised again 2026-09-09, on the founder's instruction: "lowest price even
 * for founder should be 800000".
 *
 * The floor was the only number given, and it could not be applied on its
 * own. Founding Scout was 300,000 and founding Team was already 800,000, so
 * lifting the floor to 800,000 would have put two tiers at one price. The
 * whole ladder had to move with it.
 *
 * What stopped that being a multiplication is the ceiling. Paystack's
 * Starter Business lifetime collection limit is NGN 8,000,000 account-wide,
 * so 4,000,000 is the highest any single charge can be and still leave room
 * for its own renewal. Scaling the old ladder to a 800,000 floor would have
 * put standard Partner near 10,700,000, above the entire account limit —
 * which is exactly the failure the 10,000,000 price caused on 2026-09-04 and
 * had to be reversed for. The floor is the founder's; the ceiling is
 * Paystack's; the six numbers are what fits between them.
 *
 * So the ladder is compressed rather than scaled, and the properties that
 * were argued for previously are all kept:
 *
 * The two sets still interleave, which is the point of a founding place
 * being worth something. 800,000 < 1,200,000 < 1,400,000 < 2,000,000 <
 * 2,400,000 < 4,000,000, so a founding Team buyer still pays more than a
 * standard Scout buyer, and every step up is a real step.
 *
 * The founding discount is now 33% on Scout, 30% on Team and 40% on Partner.
 * That is tighter than the old spread and deliberately so: Partner's
 * discount was the outlier at about a half, and three tiers whose discounts
 * sit within ten points of each other is a ladder rather than three separate
 * offers.
 *
 * Every tier can still take a payment and a renewal. The headroom table in
 * docs/PRODUCT_SPEC.md is the check on that and scripts/check-fee-table.mjs
 * keeps it honest: the smallest row is standard Partner at two charges, and
 * nothing is at one.
 *
 * The Kit is deliberately untouched at 95,000. The instruction was about
 * what a founding member pays for a subscription; the Kit is the one-time
 * primary offer that works with zero marketplace candidates, and raising it
 * to the subscription floor would change what the product leads with rather
 * than what it charges.
 *
 * Still free to do: nobody has subscribed. The Paystack Plan objects
 * carrying the previous amounts cannot be edited, so new ones have to be
 * created and the plan-code parameter repointed, the same way every earlier
 * raise was done.
 */
export const SUBSCRIPTION_PRICES_NGN: Record<
  SubscriptionPlan,
  { founding: number; standard: number }
> = {
  scout: { founding: 800_000, standard: 1_200_000 },
  team: { founding: 1_400_000, standard: 2_000_000 },
  partner: { founding: 2_400_000, standard: 4_000_000 },
};

/** Whether any founding place is still open. */
export function foundingPlacesRemaining(placesTaken: number): number {
  return Math.max(0, FOUNDING_SLOTS_TOTAL - placesTaken);
}

/**
 * What a plan costs to a buyer arriving when `placesTaken` founding places
 * have already gone, and whether that buyer is taking a founding place.
 *
 * The count is passed in rather than read here so that the caller that can
 * count authoritatively does the counting: the browser must never be the
 * thing that decides whether a discount applies.
 */
export function subscriptionPrice(
  plan: SubscriptionPlan,
  placesTaken: number,
): { amountNGN: number; founding: boolean } {
  const founding = foundingPlacesRemaining(placesTaken) > 0;
  const prices = SUBSCRIPTION_PRICES_NGN[plan];
  return { amountNGN: founding ? prices.founding : prices.standard, founding };
}

export const EntitlementSchema = z.object({
  employerId: z.string(),
  plan: EntitlementPlanSchema,
  status: EntitlementStatusSchema,
  kitPurchasedAt: z.string().datetime().nullable(),
  subscriptionRenewsAt: z.string().datetime().nullable(),
  /**
   * The monthly price this subscription is billed at, stamped when it starts
   * and never recomputed. "Founding members keep their price for the life of
   * the subscription" (CLAUDE.md) is the strongest commercial promise on the
   * pricing page, and until this field existed there was nowhere to record
   * which price a member held, so nothing could have honoured it. Null for
   * an employer who has never subscribed, and for entitlements written
   * before this field existed.
   */
  priceNGN: z.number().int().positive().nullable().default(null),
  /**
   * Whether this subscription took one of the founding places. Recorded
   * separately from the price because it stays true after a price change,
   * and because it is what the member is shown.
   */
  foundingMember: z.boolean().default(false),
});
export type Entitlement = z.infer<typeof EntitlementSchema>;

export const RoleStatusSchema = z.enum(['draft', 'active', 'archived']);
export const SenioritySchema = z.enum(['junior', 'mid', 'senior', 'lead']);
export type Seniority = z.infer<typeof SenioritySchema>;

export const RoleSchema = z.object({
  id: z.string(),
  employerId: z.string(),
  launchTrack: LaunchTrackSchema,
  title: z.string().min(1),
  seniority: SenioritySchema,
  outcomes: z.string().min(1),
  mustHaveWork: z.array(z.string()).min(1),
  /**
   * Human notes: start date, on-call expectations, anything that does not
   * belong in a filter. This field used to carry location too, hinted as
   * "Location, timezone overlap, start date", where no code could read it —
   * a role saying "Remote, overlapping 4 hours with WAT" filtered precisely
   * nobody. Location moved to locationRequirement below; the rest stays here
   * because the Kit document renders it for a person to read.
   */
  constraints: z.string().default(''),
  /** Absent means this role filters on location not at all. */
  locationRequirement: RoleLocationRequirementSchema.optional(),
  /**
   * What kind of engagement this is and what it pays.
   *
   * Optional because every role saved before this existed has none, and a
   * default would put words in an employer's mouth about their own pay.
   * Absent reads as "not published", which the UI says plainly rather than
   * leaving a blank where a number should be.
   */
  intent: RoleIntentSchema.optional(),
  status: RoleStatusSchema,
  createdAt: z.string().datetime(),
});
export type Role = z.infer<typeof RoleSchema>;

export const MatchStatusSchema = z.enum(['suggested', 'reviewed', 'contacted', 'rejected']);
export type MatchStatus = z.infer<typeof MatchStatusSchema>;

/**
 * How closely a match answers the role as written, kept separate from how
 * much of it is proved.
 *
 * Matching used to delete anybody who was not an exact answer: a different
 * launch track, a location outside the requirement, or no must-have backed
 * by wording all removed a candidate from the employer's list entirely. The
 * result was a shortlist that was often empty, and an employer with no way
 * to know whether that meant "nobody qualified" or "your filters removed
 * everyone".
 *
 * So nobody with verified proof is dropped now. They are placed, and the
 * placement is stated:
 *
 * - `meets`     answers the role as written, inside its location and track.
 * - `partial`   backs at least one requirement, but sits outside the
 *               location or comes from a different track.
 * - `adjacent`  has verified proof, none of which backs a stated
 *               requirement. Shown because a requirement list is a guess at
 *               what a person needs to be able to do, and proof of
 *               neighbouring work is a real signal an employer can read.
 *
 * The one thing that still removes somebody is having no verified evidence
 * at all. That is the product, not a filter: an unchecked claim never
 * reaches an employer, whatever tier it would have landed in.
 */
export const MatchFitSchema = z.enum(['meets', 'partial', 'adjacent']);
export type MatchFit = z.infer<typeof MatchFitSchema>;

export const MatchSchema = z.object({
  id: z.string(),
  roleId: z.string(),
  candidateId: z.string(),
  matchScore: z.number().min(0).max(1),
  /**
   * Optional for the same reason as the fields below: matches written before
   * tiering existed have none, and are read as `meets` by the caller so a
   * stored shortlist does not change meaning under an employer.
   */
  fit: MatchFitSchema.optional(),
  /**
   * Why this candidate is not an exact answer, and what they have instead,
   * in a sentence an employer reads rather than a code they decode. Absent
   * on a `meets` match, which needs no explaining.
   */
  fitReason: z.string().optional(),
  /**
   * The same explanation, written for the candidate.
   *
   * Two fields rather than one because the sentence has two audiences and
   * they are owed different things. `fitReason` is addressed to the
   * employer and says "they"; showing it to the candidate meant reading
   * about yourself in the third person. And a pay shortfall names the
   * role's published range to both sides but never the candidate's own
   * figure to the employer, because the profile field promises exactly
   * that and a shortlist that quoted it would break the promise on the
   * screen the employer already has open.
   *
   * Optional for the same reason `fitReason` is: shortlists written before
   * this existed have none, and a candidate simply sees no explanation
   * rather than the wrong one.
   */
  fitReasonForCandidate: z.string().optional(),
  /**
   * What this candidate said they are open to, for the employer reading the
   * shortlist.
   *
   * Matching has always read `intent.openTo`, and has only ever reported it
   * as an absence: when a candidate's list excludes what the role offers,
   * `fitReason` says so. When it includes it, or when they listed nothing,
   * the employer was told nothing either way, so "open to tutoring and
   * mentoring" and "never said" looked identical from the outside.
   *
   * That matters most to somebody about to spend an unlock. Reaching a
   * person who wants a permanent role to offer them a week of training is a
   * wasted allowance for the employer and an unwanted approach for the
   * candidate, and the fact that would have prevented it was already in the
   * database.
   *
   * Stored rather than read fresh, which is the same trade `fitReason`
   * makes two fields above: both are derived from intent at recompute and
   * both go stale together, so an employer is never shown a reason and a
   * preference that disagree. Absent means this shortlist predates the
   * field; empty means they stated no preference. The two are deliberately
   * different, because only one of them is a fact about the candidate.
   */
  candidateOpenTo: z.array(EngagementKindSchema).optional(),
  status: MatchStatusSchema,
  /**
   * Whether each side has said yes to the other.
   *
   * Both optional and both read as `unstated` when absent, so a shortlist
   * built before mutual matching existed does not suddenly read as mutual
   * rejection.
   */
  candidateInterest: InterestStateSchema.optional(),
  employerInterest: InterestStateSchema.optional(),
  contactUnlocked: z.boolean(),
  /**
   * Deterministic-baseline explanation and the evidence items it cited
   * (Phase 7 slice 6: services/api/src/domain/matching-service.ts).
   * Optional, same reasoning as contactUnlockConsent above — existing
   * Match object literals from slices 1-5's fixtures/tests keep compiling
   * without every one of them needing a rationale.
   */
  rationale: z.string().optional(),
  matchedEvidenceIds: z.array(z.string()).optional(),
  scoringVersion: z.string().optional(),
  /**
   * The strongest thing any evidence behind this match establishes.
   *
   * Used to order matches that cover the same proportion of a role's
   * requirements. Deliberately a second axis rather than a multiplier folded
   * into matchScore: this codebase removed a weight table once already,
   * because pricing evidence rather than qualifying it produced a ranked list
   * where a weaker claim could outrank a stronger one on keyword overlap
   * alone. Two numbers an employer can read beat one they cannot.
   *
   * Stored rather than derived at read time because it describes the evidence
   * that produced THIS score. Absent on matches written before ranking
   * considered strength, which sort last among their equals.
   */
  strongestEvidence: EvidenceStrengthLevelSchema.optional(),
  /**
   * Set only once an employer has requested (and the aiMatching flag has
   * allowed) a Bedrock-generated explanation for this specific match. A
   * suggestion layered on top of the deterministic rationale above, never
   * the only copy of a fact (docs/AI_SAFETY.md "Rollback").
   *
   * A stored value can outlive the flag that produced it, so the API
   * redacts this field from every match response while aiMatching is off
   * (matching-service.ts's `redactAiOutput`) rather than relying on it
   * never having been written. It is also dropped on recompute whenever
   * `matchedEvidenceIds` changes, since an explanation is only grounded in
   * the exact evidence set it was written from.
   */
  aiExplanation: z.string().optional(),
  createdAt: z.string().datetime(),
});
export type Match = z.infer<typeof MatchSchema>;

/**
 * What the Proof Hiring Kit costs today, in naira.
 *
 * One constant, imported by everything that displays or charges it. It used
 * to be declared twice — once in apps/web's pricing module for what the site
 * showed, once in services/api's kit-service for what Paystack actually
 * collected — with nothing tying them together. Two numbers that must agree
 * and cannot be checked against each other is a mispriced charge waiting to
 * happen.
 */
export const KIT_PRICE_NGN = 95_000;

export const KitOrderStatusSchema = z.enum(['pending', 'succeeded', 'failed', 'refunded']);
export type KitOrderStatus = z.infer<typeof KitOrderStatusSchema>;

export const KitOrderSchema = z.object({
  id: z.string(),
  employerId: z.string(),
  roleId: z.string(),
  /**
   * What this order actually charged, not what the Kit costs now.
   *
   * This was `z.literal(29000)`, which made the current price part of the
   * record's shape: the first price change would have made every historical
   * order fail validation, including refunded ones and the real TEST
   * purchase from 2026-08-26. An order is a record of a transaction that
   * happened, so it stores the amount that happened.
   */
  amountNGN: z.number().int().positive(),
  /**
   * Where this buyer was sent to pay.
   *
   * Stored because a retry must not ask Paystack for a second
   * transaction. `POST /transaction/initialize` answers "Duplicate
   * Transaction Reference" for a reference it has already seen — measured
   * against the live test API, against the comment beside the call that
   * assumed a retry was safe — so the idempotent path returns this instead
   * of initializing again. Null on orders written before this existed.
   */
  checkoutUrl: z.string().url().nullable().default(null),
  status: KitOrderStatusSchema,
  paystackReference: z.string(),
  createdAt: z.string().datetime(),
});
export type KitOrder = z.infer<typeof KitOrderSchema>;

export const AuditEventSchema = z.object({
  id: z.string(),
  actorId: z.string(),
  actorRole: z.enum(['candidate', 'employer', 'admin']),
  action: z.string().min(1),
  targetType: z.string().min(1),
  targetId: z.string(),
  reason: z.string().optional(),
  createdAt: z.string().datetime(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

/**
 * Whether an employer who pays to reach this candidate can actually reach
 * them.
 *
 * Founder decision, 2026-09-14: a contact unlock spends a metered allowance
 * and must return something an employer can act on. An email address alone
 * is a channel, but it is the one a stranger's message is most likely to
 * die in, and an employer who spent one of five monthly unlocks to receive
 * only an address has bought less than the page implied.
 *
 * So being findable now requires a phone number and one way to see their
 * work. `websiteUrl` is the portfolio field; LinkedIn is accepted in its
 * place because for most engineers that is where the work actually is, and
 * requiring a personal site would turn away candidates who prove themselves
 * through certifications and repositories instead. That would shrink the
 * marketplace an employer is paying for, which is the opposite of the
 * intent.
 *
 * This gates DISCOVERY, not the account. A candidate missing either keeps
 * their profile, their claims and their proofs; they are simply not shown to
 * employers until an employer could reach them. Enforcing it as a schema
 * requirement instead would reject every existing candidate's next save,
 * including people who signed up before the rule existed.
 */
export function isContactableForDiscovery(
  candidate: Pick<Candidate, 'phone' | 'linkedinUrl' | 'websiteUrl'>,
): boolean {
  const has = (value: string | undefined) => typeof value === 'string' && value.trim().length > 0;
  return has(candidate.phone) && (has(candidate.websiteUrl) || has(candidate.linkedinUrl));
}

/** What is still missing, for a candidate reading their own profile. */
export function missingContactForDiscovery(
  candidate: Pick<Candidate, 'phone' | 'linkedinUrl' | 'websiteUrl'>,
): ('phone' | 'portfolio')[] {
  const has = (value: string | undefined) => typeof value === 'string' && value.trim().length > 0;
  const missing: ('phone' | 'portfolio')[] = [];
  if (!has(candidate.phone)) missing.push('phone');
  if (!has(candidate.websiteUrl) && !has(candidate.linkedinUrl)) missing.push('portfolio');
  return missing;
}
