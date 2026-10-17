import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import SwaggerParser from '@apidevtools/swagger-parser';
import { z } from 'zod';
import {
  AuditEventSchema,
  CandidateLocationSchema,
  CandidateSchema,
  EmployerSchema,
  EntitlementSchema,
  EvidenceSchema,
  EvidenceVerificationStateSchema,
  EvidenceVisibilitySchema,
  KitOrderSchema,
  KitOrderStatusSchema,
  LaunchTrackSchema,
  MatchSchema,
  MatchStatusSchema,
  PublicProofEntrySchema,
  PublicProofSchema,
  RoleLocationRequirementSchema,
  RoleSchema,
  RoleStatusSchema,
  SenioritySchema,
  VerificationMethodSchema,
} from '../src/domain';
import {
  AccessStateSchema,
  BillingInvoiceSchema,
  BillingOverviewSchema,
  CardSummarySchema,
  PaymentAttemptSchema,
  PaymentHistoryEntrySchema,
  PaymentStatusSchema,
  SubscriptionStatusSchema,
} from '../src/billing';
import { AccountRoleSchema, SessionContextSchema } from '../src/auth';
import { AttemptHistorySchema, GradedAttemptSchema } from '../src/attempt-history';
import { EvidenceStrengthLevelSchema, EvidenceStrengthSchema } from '../src/evidence-strength';
import { PeerRelationshipSchema } from '../src/peer-attestation';
import { HealthStatusSchema } from '../src/health';

/**
 * The contract is hand-written, so nothing stops it drifting from the zod
 * schemas it claims to describe — and a contract that quietly stops matching
 * the code is worse than an honestly incomplete one, because it is trusted.
 *
 * This compares property names and which of them are required. It stops
 * short of comparing types: zod refinements and JSON Schema types do not map
 * one-to-one, and a test that had to encode every one of those mappings
 * would break on changes that are not drift. Names and optionality are where
 * real drift shows up first — a field added, renamed, or made optional.
 *
 * Coverage, so the green tick is not read as more than it is. The contract
 * declares forty-six schemas. Thirty-six are checked here: every one backed
 * by a zod schema, objects and enums alike. Fourteen were checked until
 * 2026-09-04 and the rest were documented and unguarded, which is how
 * CandidateExport came to be updated by hand.
 *
 * The remaining ten are plain TypeScript interfaces with no zod source —
 * CandidateExport, BillingDiagnostic, ProofGapPreview, SubscriptionQuote,
 * VerifiedEvidenceSummary, OfferedTask, EvidenceSource, and the three
 * Versioned* wrappers. Nothing can compare them without first giving them a
 * runtime schema, so they stay hand-maintained and are the ones to check by
 * eye when a response shape changes.
 */

const specPath = join(import.meta.dirname, '..', 'openapi.yaml');

/** Property names, and the subset that is required, for a zod object. */
function zodShape(schema: z.ZodObject<z.ZodRawShape>) {
  const shape = schema.shape;
  const names = Object.keys(shape).sort();
  const required = names
    .filter((name) => {
      const field = shape[name] as z.ZodTypeAny;
      const parsed = field.safeParse(undefined);
      // Rejecting undefined means required, plainly. Accepting it and
      // returning something else means the field has a default, which makes
      // it optional on the way in and always present on the way out — and
      // the contract describes responses, so that is required too. Only a
      // field that accepts undefined *and* yields undefined is optional.
      return !parsed.success || parsed.data !== undefined;
    })
    .sort();
  return { names, required };
}

interface JsonSchemaObject {
  properties?: Record<string, unknown>;
  required?: string[];
}

function specShape(schemas: Record<string, unknown>, name: string) {
  const schema = schemas[name] as JsonSchemaObject | undefined;
  expect(schema, `${name} is missing from the contract's components.schemas`).toBeDefined();
  return {
    names: Object.keys(schema?.properties ?? {}).sort(),
    required: [...(schema?.required ?? [])].sort(),
  };
}

describe('openapi.yaml matches packages/contracts', () => {
  const cases: Array<[string, z.ZodObject<z.ZodRawShape>]> = [
    ['HealthStatus', HealthStatusSchema],
    ['SessionContext', SessionContextSchema],
    ['Candidate', CandidateSchema],
    ['Employer', EmployerSchema],
    ['Entitlement', EntitlementSchema],
    ['Evidence', EvidenceSchema],
    ['Role', RoleSchema],
    ['Match', MatchSchema],
    ['KitOrder', KitOrderSchema],
    ['AuditEvent', AuditEventSchema],
    ['BillingOverview', BillingOverviewSchema],
    ['PaymentHistoryEntry', PaymentHistoryEntrySchema],
    ['PaymentAttempt', PaymentAttemptSchema],
    ['BillingInvoice', BillingInvoiceSchema],
    // Added 2026-09-04. Fourteen of the contract's forty-six schemas were
    // checked; the rest could drift from the code without anything noticing,
    // which is how CandidateExport came to be updated by hand. These eight
    // are the object schemas that had a zod source and were simply never
    // wired in.
    ['AttemptHistory', AttemptHistorySchema],
    ['GradedAttempt', GradedAttemptSchema],
    ['CandidateLocation', CandidateLocationSchema],
    ['RoleLocationRequirement', RoleLocationRequirementSchema],
    ['EvidenceStrength', EvidenceStrengthSchema],
    ['PublicProof', PublicProofSchema],
    ['PublicProofEntry', PublicProofEntrySchema],
    ['CardSummary', CardSummarySchema],
  ];

  for (const [name, schema] of cases) {
    it(`${name} documents the same properties the zod schema defines`, async () => {
      const api = (await SwaggerParser.parse(specPath)) as {
        components?: { schemas?: Record<string, unknown> };
      };
      const documented = specShape(api.components?.schemas ?? {}, name);
      const actual = zodShape(schema);

      expect(documented.names, `${name}: property names differ`).toEqual(actual.names);
      expect(documented.required, `${name}: required properties differ`).toEqual(actual.required);
    });
  }
});

describe('the contract describes the API it claims to', () => {
  const source = readFileSync(specPath, 'utf8');

  it('names both environments rather than only an undeployed production', () => {
    expect(source).toContain('test-api.zoryvex.space');
    expect(source).toContain('api.zoryvex.space');
  });

  it('carries the Paystack disclosure wherever a paid redirect is described', () => {
    // CLAUDE.md requires this exact wording before every paid redirect. The
    // Kit order route is the only one in this API that produces one.
    expect(source).toContain(
      "Payments are securely processed by Paystack under our business name, Abba's Solutions.",
    );
  });

  it('describes the session cookie and CSRF header as they are actually enforced', () => {
    // Read out of the code rather than written here twice. The contract said
    // `__Host-zoryvex-session` while cookies.ts uses `__Host-zoryvex_session`,
    // and an assertion that spelled the name itself would have agreed with
    // whichever one I typed into it.
    const cookies = readFileSync(
      join(import.meta.dirname, '..', '..', '..', 'services', 'api', 'src', 'http', 'cookies.ts'),
      'utf8',
    );
    const name = /SESSION_COOKIE_NAME = '([^']+)'/.exec(cookies)?.[1];
    expect(name, 'could not read the cookie name out of cookies.ts').toBeTruthy();
    expect(source).toContain(name);

    const csrf = readFileSync(
      join(import.meta.dirname, '..', '..', '..', 'services', 'api', 'handlers', 'authorizer.ts'),
      'utf8',
    );
    expect(csrf).toContain("'x-zoryvex-csrf'");
    expect(source).toContain('X-Zoryvex-Csrf');
  });
});

/**
 * The same drift, in the shape enums take.
 *
 * An enum that gains a value in the code and not in the contract is exactly
 * as misleading as a renamed property, and more likely: `mlops` was added to
 * LaunchTrack as a fourth track, and nothing here would have said if the
 * contract had kept listing three. Fourteen enums were documented and
 * unchecked.
 */
describe('openapi.yaml enums match packages/contracts', () => {
  const enums: Array<[string, z.ZodEnum<Record<string, string>>]> = [
    ['LaunchTrack', LaunchTrackSchema],
    ['AccountRole', AccountRoleSchema],
    ['Seniority', SenioritySchema],
    ['RoleStatus', RoleStatusSchema],
    ['MatchStatus', MatchStatusSchema],
    ['KitOrderStatus', KitOrderStatusSchema],
    ['EvidenceVisibility', EvidenceVisibilitySchema],
    ['EvidenceVerificationState', EvidenceVerificationStateSchema],
    ['EvidenceStrengthLevel', EvidenceStrengthLevelSchema],
    ['VerificationMethod', VerificationMethodSchema],
    ['PeerRelationship', PeerRelationshipSchema],
    ['PaymentStatus', PaymentStatusSchema],
    ['SubscriptionStatus', SubscriptionStatusSchema],
    ['AccessState', AccessStateSchema],
  ];

  for (const [name, schema] of enums) {
    it(`${name} documents the same values the zod enum defines`, async () => {
      const api = (await SwaggerParser.parse(specPath)) as {
        components?: { schemas?: Record<string, unknown> };
      };
      const documented = api.components?.schemas?.[name] as { enum?: string[] } | undefined;
      expect(documented, `${name} is missing from the contract's components.schemas`).toBeDefined();

      // Sorted on both sides: order carries no meaning in either place, and
      // comparing it would fail on a reordering that changes nothing.
      expect([...(documented?.enum ?? [])].sort(), `${name}: values differ`).toEqual(
        [...schema.options].sort(),
      );
    });
  }
});
