import { beforeEach, describe, expect, it } from 'vitest';
import { LocalDataAdapter } from '../src/local/local-data-adapter';
import { seedIfNeeded } from '../src/fixtures/index';

beforeEach(() => {
  window.localStorage.clear();
});

describe('seed fixtures — marketplace gate scenarios', () => {
  it('role_platform_lead has exactly 5 real matches (gate OPEN)', () => {
    const data = new LocalDataAdapter();
    seedIfNeeded(data);
    expect(data.listMatchesForRole('role_platform_lead')).toHaveLength(5);
  });

  it('role_sre has exactly 4 real matches (gate CLOSED, one short)', () => {
    const data = new LocalDataAdapter();
    seedIfNeeded(data);
    expect(data.listMatchesForRole('role_sre')).toHaveLength(4);
  });

  it('role_secops has zero matches (empty state)', () => {
    const data = new LocalDataAdapter();
    seedIfNeeded(data);
    expect(data.listMatchesForRole('role_secops')).toHaveLength(0);
  });

  it('is idempotent — seeding twice does not duplicate matches', () => {
    const data = new LocalDataAdapter();
    seedIfNeeded(data);
    seedIfNeeded(data);
    expect(data.listMatchesForRole('role_platform_lead')).toHaveLength(5);
  });

  it('every fixture candidate has an @example.com email, never a real-looking domain', () => {
    const data = new LocalDataAdapter();
    seedIfNeeded(data);
    const aws = data.listDiscoveryOptedCandidates('aws_cloud');
    expect(aws.length).toBeGreaterThan(0);
    for (const candidate of aws) {
      expect(candidate.email.endsWith('@example.com')).toBe(true);
    }
  });
});

describe('seed fixtures — Kit orders are per role, never the employer entitlement', () => {
  it('a role with a succeeded KitOrder does not give its employer a subscription entitlement', () => {
    const data = new LocalDataAdapter();
    seedIfNeeded(data);
    expect(data.getKitOrderForRole('role_platform_lead')?.status).toBe('succeeded');
    expect(data.getEntitlement('emp_northwind')).toEqual(
      expect.objectContaining({ plan: 'none', status: 'none' }),
    );
  });

  it('a pending KitOrder is independently seeded for a second role/employer', () => {
    const data = new LocalDataAdapter();
    seedIfNeeded(data);
    expect(data.getKitOrderForRole('role_sre')?.status).toBe('pending');
  });
});
