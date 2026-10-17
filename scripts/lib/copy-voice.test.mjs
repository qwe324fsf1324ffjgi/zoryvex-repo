import { describe, expect, it } from 'vitest';
import { BANNED_VOCABULARY, findVoiceViolations, stripComments } from './copy-voice.mjs';
import { auditCopy } from '../check-copy-voice.mjs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');

describe('stripComments', () => {
  it('removes every comment form this codebase writes', () => {
    const stripped = stripComments(`
// a line comment — with an em dash
/* a block comment — with one too */
{/* a JSX comment — and one here */}
const real = 'kept';`);
    expect(stripped).not.toContain('line comment');
    expect(stripped).not.toContain('block comment');
    expect(stripped).not.toContain('JSX comment');
    expect(stripped).toContain("const real = 'kept'");
  });

  it('keeps line numbers, which is the whole reason it exists', () => {
    // The first version replaced a multi-line comment with a single space,
    // so every violation after one was reported several lines off and
    // pointed at an innocent line. A checker that names the wrong line is
    // worse than no checker.
    const source = ['const a = 1;', '/* one', 'two', 'three */', 'const b = 2;'].join('\n');
    const stripped = stripComments(source);
    expect(stripped.split('\n')).toHaveLength(5);
    expect(stripped.split('\n')[4]).toBe('const b = 2;');
  });
});

describe('findVoiceViolations', () => {
  it('catches CLAUDE.md’s banned vocabulary in copy', () => {
    const found = findVoiceViolations('<p>A seamless experience</p>');
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe('vocabulary');
    expect(found[0].detail).toContain('seamless');
  });

  it('never fires on a code comment', () => {
    // This file, and the checker itself, are full of the punctuation and
    // sometimes the words the rule bans. The rule is about how the product
    // speaks, not how the source explains itself.
    expect(findVoiceViolations('// this is a seamless — holistic explanation')).toEqual([]);
  });

  it('catches an em dash in a paragraph', () => {
    const found = findVoiceViolations('<p>It cannot be a fork — we check what you started.</p>');
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe('em-dash');
  });

  it('allows the compact label CLAUDE.md names as fine', () => {
    // "Item — price", verbatim from the rule's own exemption.
    expect(findVoiceViolations('<h2>Proof Hiring Kit — NGN 95,000, one-time</h2>')).toEqual([]);
  });

  it('allows that label when JSX splits it across lines', () => {
    // Which JSX does the moment the line gets long, and it gets long exactly
    // when the heading holds a price.
    const source = [
      '<h2 className="text-2xl font-bold text-ink-950">',
      '  Proof Hiring Kit — {formatNGN(KIT_PRICE_NGN)}, one-time',
      '</h2>',
    ].join('\n');
    expect(findVoiceViolations(source)).toEqual([]);
  });

  it('does not let the heading exemption swallow the rule', () => {
    // A heading long enough to be a sentence is a sentence.
    const long =
      '<h2>Everything you need to know about hiring well this year — and why the usual answer stopped working</h2>';
    expect(findVoiceViolations(long)).toHaveLength(1);
  });

  it('leaves a page title alone', () => {
    expect(findVoiceViolations("export const metadata = { title: 'Pricing — Zoryvex' };")).toEqual(
      [],
    );
  });
});

describe('the real product copy', () => {
  it('matches the voice rules', () => {
    const { violations, fileCount } = auditCopy({ root });
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
    // Guards the guard: a scope that silently matched nothing would pass.
    expect(fileCount).toBeGreaterThan(40);
  });

  it('checks for every word CLAUDE.md lists', () => {
    for (const word of ['seamless', 'leverage', 'frictionless', 'world-class', 'supercharge']) {
      expect(BANNED_VOCABULARY).toContain(word);
    }
  });
});
