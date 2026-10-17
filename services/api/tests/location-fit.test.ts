import { describe, expect, it } from 'vitest';
import type { CandidateLocation, RoleLocationRequirement } from '@zoryvex/contracts';
import {
  evaluateLocationFit,
  hasLocationRequirement,
  timezoneDifferenceHours,
} from '../src/domain/location-fit';

const WAT = 60; // Nigeria, UTC+1, where this product's roles mostly are.

const requirement = (over: Partial<RoleLocationRequirement> = {}): RoleLocationRequirement => ({
  countries: [],
  utcOffsetMinutes: WAT,
  maxTimezoneDifferenceHours: null,
  ...over,
});

const at = (country: string, utcOffsetMinutes: number): CandidateLocation => ({
  country,
  utcOffsetMinutes,
});

describe('timezoneDifferenceHours', () => {
  it('measures the ordinary case', () => {
    expect(timezoneDifferenceHours(WAT, WAT)).toBe(0);
    expect(timezoneDifferenceHours(WAT, WAT + 180)).toBe(3);
    expect(timezoneDifferenceHours(WAT, WAT - 180)).toBe(3);
  });

  /**
   * The bug this function exists to avoid. Subtracted naively, UTC+13 and
   * UTC-11 are 24 hours apart, so a role in Auckland would reject a
   * candidate whose clock reads exactly the same time as its own.
   */
  it('takes the shorter way round the clock', () => {
    expect(timezoneDifferenceHours(13 * 60, -11 * 60)).toBe(0);
    expect(timezoneDifferenceHours(12 * 60, -11 * 60)).toBe(1);
    expect(timezoneDifferenceHours(14 * 60, -10 * 60)).toBe(0);
  });

  it('handles the half-hour and quarter-hour offsets that really exist', () => {
    expect(timezoneDifferenceHours(WAT, 330)).toBe(4.5); // India, UTC+5:30
    expect(timezoneDifferenceHours(0, 345)).toBe(5.75); // Nepal, UTC+5:45
  });

  it('is symmetric, because "far apart" has no direction', () => {
    expect(timezoneDifferenceHours(WAT, 480)).toBe(timezoneDifferenceHours(480, WAT));
  });
});

describe('evaluateLocationFit', () => {
  it('lets everyone through when the role asks for nothing', () => {
    expect(evaluateLocationFit(undefined, at('KE', 180))).toEqual({
      fits: true,
      reason: 'no-requirement',
    });
  });

  /**
   * The rule that matters most. Location arrived on 2026-09-01 and every
   * candidate who signed up before it has none. Dropping them would be a
   * silent rejection caused by a schema change, invisible to the employer
   * and to the candidate alike.
   */
  it('never excludes a candidate who has not stated a location', () => {
    const strict = requirement({ countries: ['NG'], maxTimezoneDifferenceHours: 0 });
    expect(evaluateLocationFit(strict, undefined)).toEqual({
      fits: true,
      reason: 'location-not-stated',
    });
  });

  describe('country', () => {
    it('admits a candidate in an allowed country', () => {
      const fit = evaluateLocationFit(requirement({ countries: ['NG', 'KE'] }), at('KE', 180));
      expect(fit.fits).toBe(true);
    });

    it('excludes a candidate outside every allowed country, and says which', () => {
      const fit = evaluateLocationFit(requirement({ countries: ['NG', 'KE'] }), at('ZA', 120));
      expect(fit).toMatchObject({ fits: false, reason: 'country' });
      if (!fit.fits) {
        expect(fit.explanation).toContain('ZA');
        expect(fit.explanation).toContain('NG, KE');
      }
    });

    it('treats an empty country list as anywhere rather than nowhere', () => {
      // An allow-list that is empty is the easiest thing in the world to
      // read backwards, and reading it backwards would exclude every
      // candidate on the platform from every role.
      expect(evaluateLocationFit(requirement({ countries: [] }), at('ZA', 120)).fits).toBe(true);
    });
  });

  describe('timezone', () => {
    it('admits a candidate inside the allowed difference', () => {
      const req = requirement({ maxTimezoneDifferenceHours: 3 });
      expect(evaluateLocationFit(req, at('KE', 180)).fits).toBe(true); // 2 hours
    });

    it('admits a candidate exactly at the limit', () => {
      // "up to 3 hours" includes 3. An off-by-one here quietly loses the
      // candidates sitting precisely on the boundary the employer chose.
      const req = requirement({ maxTimezoneDifferenceHours: 3 });
      expect(evaluateLocationFit(req, at('KE', WAT + 180)).fits).toBe(true);
    });

    it('excludes a candidate beyond the limit, and says by how much', () => {
      const req = requirement({ maxTimezoneDifferenceHours: 3 });
      const fit = evaluateLocationFit(req, at('US', -300)); // UTC-5, 6 hours from WAT
      expect(fit).toMatchObject({ fits: false, reason: 'timezone' });
      if (!fit.fits) {
        expect(fit.explanation).toContain('6 hours');
        expect(fit.explanation).toContain('3 hours');
      }
    });

    it('reads a zero limit as "the same offset", not as "no limit"', () => {
      const req = requirement({ maxTimezoneDifferenceHours: 0 });
      expect(evaluateLocationFit(req, at('NG', WAT)).fits).toBe(true);
      expect(evaluateLocationFit(req, at('KE', 180)).fits).toBe(false);
    });

    it('reads a null limit as no limit', () => {
      const req = requirement({ maxTimezoneDifferenceHours: null });
      expect(evaluateLocationFit(req, at('NZ', 780)).fits).toBe(true);
    });

    it('says half hours as half hours', () => {
      const req = requirement({ utcOffsetMinutes: 0, maxTimezoneDifferenceHours: 4 });
      const fit = evaluateLocationFit(req, at('IN', 330)); // UTC+5:30
      expect(fit.fits).toBe(false);
      if (!fit.fits) expect(fit.explanation).toContain('5.5 hours');
    });
  });

  it('reports the country before the timezone when both fail', () => {
    // Not arbitrary: an employer who cannot pay someone in that country will
    // not be persuaded by their working hours, so it is the useful half of
    // the answer.
    const req = requirement({ countries: ['NG'], maxTimezoneDifferenceHours: 1 });
    const fit = evaluateLocationFit(req, at('NZ', 780));
    expect(fit).toMatchObject({ fits: false, reason: 'country' });
  });

  it('admits a candidate who satisfies both', () => {
    const req = requirement({ countries: ['NG', 'KE'], maxTimezoneDifferenceHours: 2 });
    expect(evaluateLocationFit(req, at('KE', 180))).toEqual({
      fits: true,
      reason: 'meets-requirement',
    });
  });
});

describe('hasLocationRequirement', () => {
  it('is false for no requirement and for one that constrains nothing', () => {
    expect(hasLocationRequirement(undefined)).toBe(false);
    expect(hasLocationRequirement(requirement())).toBe(false);
  });

  it('is true as soon as either dimension is set', () => {
    expect(hasLocationRequirement(requirement({ countries: ['NG'] }))).toBe(true);
    expect(hasLocationRequirement(requirement({ maxTimezoneDifferenceHours: 4 }))).toBe(true);
  });
});
