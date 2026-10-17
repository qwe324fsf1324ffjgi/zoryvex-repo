import { describe, expect, it } from 'vitest';
import type { EvidenceStrengthLevel, PublicProof } from '@zoryvex/contracts';
import { renderProofBadge } from '../src/domain/proof-badge';

function page(overrides: Partial<PublicProof> = {}): PublicProof {
  return {
    displayName: 'A Candidate',
    launchTrack: 'aws_cloud',
    proofs: [],
    generatedAt: '2026-09-01T12:00:00.000Z',
    ...overrides,
  };
}

const proof = (verifiedAt: string) => ({
  claim: 'A thing that was checked',
  verificationMethod: 'issuer_badge' as const,
  verificationDetail: 'Confirmed with the issuer',
  verifiedAt,
  // The badge deliberately renders none of this — it is a count and a date.
  // Present because the page carries it, so the fixture matches the real
  // shape rather than a convenient subset of it.
  strength: {
    attained: ['claimed', 'knowledge_assessed'] as EvidenceStrengthLevel[],
    basis: { claimed: 'x', knowledge_assessed: 'y' },
    unsupported: ['process_observed'] as EvidenceStrengthLevel[],
  },
  // The badge renders none of this. Present so the fixture matches the real
  // shape rather than a convenient subset of it.
  peerAttestations: [],
});

describe('renderProofBadge', () => {
  it('is well-formed SVG with an accessible name', () => {
    const svg = renderProofBadge(page({ proofs: [proof('2026-08-01T00:00:00.000Z')] }));
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    expect(svg).toContain('role="img"');
    expect(svg).toContain('<title>');
    expect(svg).toContain('aria-label=');
  });

  /**
   * The design decision that makes it ours. A badge saying only "Verified"
   * implies permanence, which is a lie about how credentials work: a reader
   * cannot tell a check from this morning apart from one from last year.
   */
  it('carries a count and a date rather than the word verified', () => {
    const svg = renderProofBadge(page({ proofs: [proof('2026-08-01T00:00:00.000Z')] }));
    expect(svg).toContain('1 proof');
    expect(svg).toContain('checked 1 August 2026');
    expect(svg.toLowerCase()).not.toContain('verified');
  });

  it('pluralises honestly', () => {
    const two = renderProofBadge(
      page({ proofs: [proof('2026-08-01T00:00:00.000Z'), proof('2026-07-01T00:00:00.000Z')] }),
    );
    expect(two).toContain('2 proofs');
  });

  it('dates itself from the most recent check, not the oldest', () => {
    const svg = renderProofBadge(
      page({ proofs: [proof('2026-02-01T00:00:00.000Z'), proof('2026-08-20T00:00:00.000Z')] }),
    );
    expect(svg).toContain('checked 20 August 2026');
    expect(svg).not.toContain('February');
  });

  /**
   * An empty badge has to be honest rather than absent. Rendering nothing
   * would be fine; rendering something that looked verified would be the
   * enemy in SVG form.
   */
  it('says plainly when nothing has been checked', () => {
    const svg = renderProofBadge(page({ proofs: [] }));
    expect(svg).toContain('0 proofs');
    expect(svg).toContain('nothing checked yet');
  });

  it('greys the accent stroke when there is nothing to accent', () => {
    expect(renderProofBadge(page({ proofs: [] }))).toContain('#8d94a1');
    expect(renderProofBadge(page({ proofs: [proof('2026-08-01T00:00:00.000Z')] }))).toContain(
      '#0b6b4f',
    );
  });

  /**
   * The badge is rendered from candidate-controlled text nowhere today, and
   * this is what keeps that true if a name or a claim is ever added to it.
   * An unescaped `<` would let somebody put script into an image other
   * people embed on their own sites.
   */
  it('escapes markup rather than emitting it', () => {
    const svg = renderProofBadge(
      page({
        proofs: [
          {
            ...proof('2026-08-01T00:00:00.000Z'),
            verificationDetail: '</svg><script>alert(1)</script>',
          },
        ],
      }),
    );
    expect(svg).not.toContain('<script>');
  });

  it('never carries anything that is not already public', () => {
    const svg = renderProofBadge(
      page({ displayName: 'A Candidate', proofs: [proof('2026-08-01T00:00:00.000Z')] }),
    );
    // The badge is a count and a date. It deliberately does not name the
    // person: it gets embedded on pages that already say who they are, and a
    // name in an image is a name that cannot be revoked with the page.
    expect(svg).not.toContain('A Candidate');
  });

  it('survives an unreadable date without emitting a broken one', () => {
    const svg = renderProofBadge(page({ proofs: [proof('not-a-date')] }));
    expect(svg).toContain('unknown');
    expect(svg).not.toContain('NaN');
    expect(svg).not.toContain('Invalid');
  });
});
