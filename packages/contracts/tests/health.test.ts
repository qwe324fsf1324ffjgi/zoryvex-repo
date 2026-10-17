import { describe, expect, it } from 'vitest';
import { HealthStatusSchema } from '../src/health';

const valid = {
  status: 'ok',
  timestamp: new Date().toISOString(),
  version: 'abc1234',
  environment: 'test',
};

describe('HealthStatusSchema', () => {
  it('accepts a well-formed health payload', () => {
    expect(HealthStatusSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a status other than ok', () => {
    expect(HealthStatusSchema.safeParse({ ...valid, status: 'degraded' }).success).toBe(false);
  });

  it('rejects a non-ISO timestamp', () => {
    expect(HealthStatusSchema.safeParse({ ...valid, timestamp: 'not-a-date' }).success).toBe(false);
  });

  /**
   * The deploy smoke test compares this field against the commit being
   * deployed, so a payload without it would make that check silently
   * vacuous rather than failing loudly.
   */
  it('requires a version, because the deploy check reads it', () => {
    const withoutVersion = {
      status: valid.status,
      timestamp: valid.timestamp,
      environment: 'test',
    };
    expect(HealthStatusSchema.safeParse(withoutVersion).success).toBe(false);
    expect(HealthStatusSchema.safeParse({ ...valid, version: '' }).success).toBe(false);
  });

  it('requires an environment', () => {
    const withoutEnvironment = {
      status: valid.status,
      timestamp: valid.timestamp,
      version: 'abc1234',
    };
    expect(HealthStatusSchema.safeParse(withoutEnvironment).success).toBe(false);
  });
});
