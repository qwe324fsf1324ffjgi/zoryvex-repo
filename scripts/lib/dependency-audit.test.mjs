import { describe, expect, it } from 'vitest';
import {
  AUDIT_OUTCOME,
  classifyAuditResult,
  parseFindings,
  blockingAdvisories,
} from './dependency-audit.mjs';

const report = (vulnerabilities, detail = {}) =>
  JSON.stringify({ metadata: { vulnerabilities }, vulnerabilities: detail });

const none = { critical: 0, high: 0, moderate: 0, low: 0 };

describe('classifyAuditResult', () => {
  it('treats a zero exit as clean', () => {
    expect(classifyAuditResult({ exitCode: 0, stdout: report(none) })).toBe(AUDIT_OUTCOME.clean);
  });

  it('treats reported high findings as vulnerable', () => {
    const stdout = report({ ...none, high: 2 });
    expect(classifyAuditResult({ exitCode: 1, stdout })).toBe(AUDIT_OUTCOME.vulnerable);
  });

  /**
   * The failure that prompted this. npm exits non-zero and prints a
   * transport error rather than a report; the previous gate read that as
   * "audit failed" and blocked the deploy, though nothing about this
   * repository had changed.
   */
  it('treats an unreachable advisory endpoint as unreachable, not vulnerable', () => {
    const stderr = 'npm error audit endpoint returned an error';
    expect(classifyAuditResult({ exitCode: 1, stdout: 'undefined', stderr })).toBe(
      AUDIT_OUTCOME.unreachable,
    );
  });

  it('recognises the transport failures npm reports by errno', () => {
    for (const stderr of [
      'request to https://registry.npmjs.org/-/npm/v1/security/advisories/bulk failed',
      'npm warn audit network timeout at: https://registry.npmjs.org',
      'getaddrinfo ENOTFOUND registry.npmjs.org',
      'connect ETIMEDOUT',
      'socket hang up',
      '503 Service Unavailable',
    ]) {
      expect(classifyAuditResult({ exitCode: 1, stdout: '', stderr }), stderr).toBe(
        AUDIT_OUTCOME.unreachable,
      );
    }
  });

  /**
   * The direction this must never fail in. A real finding alongside an
   * unrelated network warning has to keep blocking - otherwise a noisy log
   * line becomes a way to ship a vulnerable dependency.
   */
  it('still blocks when findings and a network warning appear together', () => {
    const stdout = report({ ...none, critical: 1 });
    const stderr = 'npm warn audit network timeout at: https://registry.npmjs.org';
    expect(classifyAuditResult({ exitCode: 1, stdout, stderr })).toBe(AUDIT_OUTCOME.vulnerable);
  });

  it('blocks on an unexplained non-zero exit rather than guessing', () => {
    expect(
      classifyAuditResult({ exitCode: 1, stdout: '', stderr: 'something else entirely' }),
    ).toBe(AUDIT_OUTCOME.vulnerable);
  });

  it('does not treat moderate or low findings as blocking', () => {
    // The gate runs at --audit-level=high, so a non-zero exit carrying only
    // moderate findings is not what it is there to catch.
    const stdout = report({ ...none, moderate: 4, low: 9 });
    expect(parseFindings(stdout).total).toBe(0);
  });
});

describe('parseFindings', () => {
  it('counts only the levels the gate blocks on', () => {
    const stdout = report({ critical: 1, high: 2, moderate: 3, low: 4 });
    expect(parseFindings(stdout)).toEqual({
      critical: 1,
      high: 2,
      moderate: 3,
      low: 4,
      total: 3,
    });
  });

  it('returns null for output that is not the JSON report', () => {
    // How a transport failure usually presents: npm prints "undefined".
    expect(parseFindings('undefined')).toBeNull();
    expect(parseFindings('')).toBeNull();
    expect(parseFindings('{"metadata":{}}')).toBeNull();
  });
});

describe('blockingAdvisories', () => {
  it('names the high and critical packages, sorted', () => {
    const stdout = report(
      { ...none, high: 1, critical: 1 },
      {
        'fast-uri': { severity: 'high' },
        lodash: { severity: 'critical' },
        chalk: { severity: 'moderate' },
      },
    );
    expect(blockingAdvisories(stdout)).toEqual(['fast-uri (high)', 'lodash (critical)']);
  });

  it('returns nothing rather than throwing on unparseable output', () => {
    expect(blockingAdvisories('undefined')).toEqual([]);
  });
});
