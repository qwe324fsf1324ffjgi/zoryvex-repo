import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FEATURE_FLAGS } from '@zoryvex/config';
import {
  compareFeatureFlags,
  describeFeatureFlagDrift,
  hasFeatureFlagDrift,
  hasUnsafeFeatureFlagDrift,
  parseDeclaredFlags,
} from './feature-flag-drift.mjs';
import { SCHEMA_FLAG_KEYS, declaredFlagsForEnvironment } from '../check-feature-flags.mjs';

const root = join(import.meta.dirname, '..', '..');
const schemaKeys = SCHEMA_FLAG_KEYS;

describe('SCHEMA_FLAG_KEYS', () => {
  it('is exactly what FeatureFlagsSchema defines', () => {
    // Adding a flag to the schema without adding it here would silently
    // narrow what the drift check looks at, which is the failure this whole
    // file exists to prevent one level up.
    expect([...SCHEMA_FLAG_KEYS].sort()).toEqual(Object.keys(DEFAULT_FEATURE_FLAGS).sort());
  });
});

describe('parseDeclaredFlags', () => {
  it('reads the real test environment', () => {
    const flags = declaredFlagsForEnvironment('test', { root });
    expect(Object.keys(flags).sort()).toEqual([...schemaKeys].sort());
    // TEST exists to exercise the whole product with test-mode Paystack
    // keys, so these two are on here and off in production.
    expect(flags.payments).toBe(true);
    expect(flags.contactUnlocks).toBe(true);
    expect(flags.aiMatching).toBe(false);
    expect(flags.verificationReminders).toBe(false);
  });

  it('reads the real production environment, which is all-off', () => {
    const flags = declaredFlagsForEnvironment('production', { root });
    expect(Object.keys(flags).sort()).toEqual([...schemaKeys].sort());
    expect(Object.values(flags).every((v) => v === false)).toBe(true);
  });

  it('handles the value being written across several lines', () => {
    const source = `
resource "aws_ssm_parameter" "feature_flags" {
  name  = "/zoryvex/test/feature-flags"
  value = jsonencode({
    payments   = true,
    aiMatching = false,
  })
}`;
    expect(parseDeclaredFlags(source)).toEqual({ payments: true, aiMatching: false });
  });

  it('refuses a value it only half understands rather than guessing', () => {
    const source = `
resource "aws_ssm_parameter" "feature_flags" {
  value = jsonencode({ payments = var.payments_enabled, aiMatching = false })
}`;
    expect(() => parseDeclaredFlags(source)).toThrow(/other than plain booleans/);
  });

  it('throws when there is no such resource', () => {
    expect(() => parseDeclaredFlags('resource "aws_s3_bucket" "x" {}')).toThrow(
      /No aws_ssm_parameter/,
    );
  });

  it('throws when the value is not a jsonencode object', () => {
    const source = `
resource "aws_ssm_parameter" "feature_flags" {
  value = var.flags_json
}`;
    expect(() => parseDeclaredFlags(source)).toThrow(/only understands that form/);
  });
});

describe('compareFeatureFlags', () => {
  const allFalse = Object.fromEntries(schemaKeys.map((k) => [k, false]));

  it('reports no drift when live matches declared', () => {
    const declared = { ...allFalse, payments: true, contactUnlocks: true };
    const result = compareFeatureFlags({ declared, live: { ...declared }, schemaKeys });
    expect(hasFeatureFlagDrift(result)).toBe(false);
    expect(hasUnsafeFeatureFlagDrift(result)).toBe(false);
  });

  it('catches the live TEST state: payments declared on, live off', () => {
    const declared = { ...allFalse, payments: true, contactUnlocks: true };
    const live = {
      aiMatching: false,
      contactUnlocks: false,
      payments: false,
      publicDiscovery: false,
    };
    const result = compareFeatureFlags({ declared, live, schemaKeys });

    expect(result.disabledBelowDeclared.sort()).toEqual(['contactUnlocks', 'payments']);
    expect(result.missingLiveKeys).toEqual(['verificationReminders']);
    expect(result.enabledBeyondDeclared).toEqual([]);
    expect(hasFeatureFlagDrift(result)).toBe(true);
    // Off-when-declared-on is what a lockdown looks like, so it is drift but
    // not the direction that should read as an incident.
    expect(hasUnsafeFeatureFlagDrift(result)).toBe(false);
  });

  it('catches the 2026-08-18 incident shape: aiMatching on live, off in Terraform', () => {
    const result = compareFeatureFlags({
      declared: allFalse,
      live: { aiMatching: true, contactUnlocks: true },
      schemaKeys,
    });
    expect(result.enabledBeyondDeclared.sort()).toEqual(['aiMatching', 'contactUnlocks']);
    expect(hasUnsafeFeatureFlagDrift(result)).toBe(true);
  });

  it('catches a stray key, which turns every flag off without erroring anywhere', () => {
    const result = compareFeatureFlags({
      declared: allFalse,
      live: { ...allFalse, payments: true, newFlagNobodyAdded: true },
      schemaKeys,
    });
    expect(result.unknownLiveKeys).toEqual(['newFlagNobodyAdded']);
    expect(result.everythingSilentlyOff).toBe(true);
    expect(hasUnsafeFeatureFlagDrift(result)).toBe(true);
  });

  it('catches a schema flag Terraform never declares', () => {
    const declared = { payments: false };
    const result = compareFeatureFlags({ declared, live: allFalse, schemaKeys });
    expect(result.declaredMissingKeys).toEqual(schemaKeys.filter((k) => k !== 'payments'));
    expect(hasFeatureFlagDrift(result)).toBe(true);
  });
});

describe('describeFeatureFlagDrift', () => {
  const allFalse = Object.fromEntries(schemaKeys.map((k) => [k, false]));

  it('says so plainly when there is nothing wrong', () => {
    const result = compareFeatureFlags({ declared: allFalse, live: allFalse, schemaKeys });
    expect(describeFeatureFlagDrift(result, { environment: 'test' })).toBe(
      'Feature flags in test match what Terraform declares.',
    );
  });

  it('names the flags and explains which direction they moved', () => {
    const result = compareFeatureFlags({
      declared: { ...allFalse, payments: true },
      live: { ...allFalse, aiMatching: true },
      schemaKeys,
    });
    const text = describeFeatureFlagDrift(result, { environment: 'test' });
    expect(text).toContain('On live, off in Terraform: aiMatching');
    expect(text).toContain('Off live, on in Terraform: payments');
  });
});

describe('the checker script itself', () => {
  const source = readFileSync(join(root, 'scripts', 'check-feature-flags.mjs'), 'utf8');

  it('never writes', () => {
    // The document is exempt from Terraform precisely because changing it is
    // a decision. A reconciling --fix would put that decision back into a
    // pipeline.
    //
    // Matched on the argv form (a quoted element in the array passed to
    // execFileSync) rather than the bare word, because the script's own
    // failure message tells an operator to run put-parameter by hand — which
    // is the point, and is not the script doing it.
    const argvElements = [...source.matchAll(/'([a-z-]+)',/g)].map((m) => m[1]);
    expect(argvElements).toContain('get-parameter');
    expect(argvElements).not.toContain('put-parameter');
    expect(argvElements).not.toContain('delete-parameter');
    expect(source).not.toContain("=== '--fix'");
  });

  it('keeps "could not measure" separate from "measured and wrong"', () => {
    expect(source).toContain('process.exit(2)');
    expect(source).toContain('process.exit(1)');
  });
});
