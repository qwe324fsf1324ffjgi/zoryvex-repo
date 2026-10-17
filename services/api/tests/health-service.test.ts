import { describe, expect, it } from 'vitest';
import { getHealthStatus } from '../src/domain/health-service';
import type { Clock } from '../src/repositories/clock-repository';

class FixedClock implements Clock {
  constructor(private readonly fixed: Date) {}
  now(): Date {
    return this.fixed;
  }
}

const build = { version: 'abc1234', environment: 'test' };

describe('getHealthStatus', () => {
  it('reports ok with the clock-provided timestamp', () => {
    const fixed = new Date('2026-01-01T00:00:00.000Z');
    const result = getHealthStatus(new FixedClock(fixed), build);
    expect(result).toEqual({
      status: 'ok',
      timestamp: '2026-01-01T00:00:00.000Z',
      version: 'abc1234',
      environment: 'test',
    });
  });

  /**
   * The build identity has to be reported verbatim. If this were derived,
   * defaulted, or normalised anywhere along the way, the deploy check that
   * compares it against the deployed commit would compare the wrong thing.
   */
  it('reports the build identity it was given, unchanged', () => {
    const result = getHealthStatus(new FixedClock(new Date()), {
      version: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      environment: 'production',
    });
    expect(result.version).toBe('deadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
    expect(result.environment).toBe('production');
  });
});
