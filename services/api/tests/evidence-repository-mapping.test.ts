import { describe, expect, it } from 'vitest';
import { EvidenceSchema } from '@zoryvex/contracts';

/**
 * Guards a real bug found in a 2026-08-27 audit.
 *
 * evidence-repository's itemToEvidence used to copy named fields across one
 * by one. Adding a field to EvidenceSchema therefore dropped it silently on
 * every read, with nothing failing anywhere. It had already happened:
 * markEvidenceVerified wrote verificationMethod, verifiedAt and
 * verificationRef to the table, and this mapper threw them away on the way
 * back out — so the proof behind a verified claim existed in DynamoDB and was
 * unreadable by the API, and the verify page could never show what had
 * actually been checked.
 *
 * The mapper now parses the whole item. These tests pin the two properties
 * that makes safe: every schema field survives, and no storage key leaks.
 */

const STORED_ITEM = {
  // Storage-only attributes that must never reach the domain object.
  PK: 'CANDIDATE#cand_1',
  SK: 'EVIDENCE#ev_1',
  version: 3,
  GSI1PK: 'something',

  id: 'ev_1',
  candidateId: 'cand_1',
  source: 'certification',
  claim: 'AWS Certified Solutions Architect',
  context: 'Passed the associate exam',
  actions: 'Studied and sat the exam',
  outcome: 'Certified',
  verificationState: 'verified',
  verificationMethod: 'issuer_badge',
  verifiedAt: '2026-08-27T00:00:00.000Z',
  verificationRef: '11111111-2222-4333-8444-555555555555',
  visibility: 'discovery',
  consentGiven: true,
  createdAt: '2026-08-19T00:00:00.000Z',
  updatedAt: '2026-08-27T00:00:00.000Z',
};

describe('evidence row mapping', () => {
  it('keeps the verification proof that a hand-written field list dropped', () => {
    const parsed = EvidenceSchema.parse(STORED_ITEM);
    expect(parsed.verificationMethod).toBe('issuer_badge');
    expect(parsed.verifiedAt).toBe('2026-08-27T00:00:00.000Z');
    expect(parsed.verificationRef).toBe('11111111-2222-4333-8444-555555555555');
  });

  it('strips storage keys, so parsing the whole item is safe to do', () => {
    // This is the property that lets the mapper be a single parse call
    // instead of a list that has to be maintained by hand.
    const parsed = EvidenceSchema.parse(STORED_ITEM) as Record<string, unknown>;
    for (const key of ['PK', 'SK', 'version', 'GSI1PK']) {
      expect(key in parsed, `${key} leaked into the domain object`).toBe(false);
    }
  });

  it('drops nothing the stored item actually carries', () => {
    // The original bug in one assertion: fields present in DynamoDB that the
    // mapper simply did not copy across. Asserted against what the item
    // holds rather than against every schema key, because sourceUrl and
    // fileId are mutually exclusive and no single row carries both.
    const parsed = EvidenceSchema.parse(STORED_ITEM) as Record<string, unknown>;
    const schemaKeys = new Set(Object.keys(EvidenceSchema.shape));
    for (const key of Object.keys(STORED_ITEM)) {
      if (!schemaKeys.has(key)) continue;
      expect(key in parsed, `${key} was stored but did not survive the read`).toBe(true);
    }
  });

  it('carries a source link through when the row has one', () => {
    const withLink = { ...STORED_ITEM, sourceUrl: 'https://example.com/proof' };
    expect(EvidenceSchema.parse(withLink).sourceUrl).toBe('https://example.com/proof');
  });

  it('carries an attached file id through when the row has one', () => {
    const withFile = { ...STORED_ITEM, fileId: 'file_1' };
    expect(EvidenceSchema.parse(withFile).fileId).toBe('file_1');
  });
});
