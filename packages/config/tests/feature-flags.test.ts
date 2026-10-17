import { describe, expect, it } from 'vitest';
import { FeatureFlagsSchema, DEFAULT_FEATURE_FLAGS } from '../src/feature-flags';

describe('FeatureFlagsSchema', () => {
  it('defaults every flag to false when the input is empty', () => {
    const result = FeatureFlagsSchema.parse({});
    expect(result).toEqual(DEFAULT_FEATURE_FLAGS);
  });

  it('rejects an unknown flag name', () => {
    const result = FeatureFlagsSchema.safeParse({ payments: false, unknownFlag: true });
    expect(result.success).toBe(false);
  });

  it('accepts an explicit true value for a known flag', () => {
    const result = FeatureFlagsSchema.parse({ payments: true });
    expect(result.payments).toBe(true);
  });
});
