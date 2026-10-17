import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { glob } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

/**
 * The heading scale, enforced instead of only written down.
 *
 * `Section.tsx` carries a long comment recording the scale after an audit on
 * 2026-09-03 found `h1` rendering at four different sizes across four pages,
 * one page using two sizes in two branches of itself. The comment ends by
 * saying the convention was "already perfect and entirely unwritten, which is
 * precisely how h1 drifted", and that the comment is the guard.
 *
 * A comment is not a guard. On 2026-09-05, five `h2` elements were found at
 * `text-lg`, a size the scale does not contain, on the billing and employer
 * onboarding pages: "Marketplace subscriptions", "Kit orders", "Payment
 * history", "Invite teammates". They do the same job as "Candidate matches"
 * and "Your claims", which are `text-xl`, and two of them sit on the page
 * where somebody decides to spend hundreds of thousands a month.
 *
 * So the size half of the scale is asserted here. Only the size: weight and
 * colour are left alone, because a Card title on the public proof page uses
 * `font-bold` rather than `font-semibold` as a deliberate emphasis on a page
 * whose entire content is claims, and turning a judgement call into a failing
 * test is how a guard starts getting deleted.
 *
 *   text-2xl   a section heading on a marketing page that sells
 *   text-xl    a section heading on an app page or a legal page
 *   (no size)  a title inside a Card, which inherits
 */

const ALLOWED = new Set(['text-2xl', 'text-xl']);

/**
 * `h2` is also used for things that are not section headings, and those are
 * listed rather than silently permitted, on this codebase's own rule that an
 * exception written down is a decision and an exception that is not is drift.
 *
 * Each of these was looked at and left alone deliberately. Forcing a dialog
 * title or an uppercase eyebrow to a section-heading size would make the
 * interface worse to satisfy a rule that was never written about them.
 *
 * A new entry here should be a considered choice. A new heading that is
 * really a section heading belongs in the scale instead.
 */
const WRITTEN_DOWN_EXCEPTIONS = new Map<string, string>([
  [
    'components/ui/Dialog.tsx',
    'the dialog title, which is a dialog label rather than a page section',
  ],
  [
    'employer/(app)/role/checkout/page.tsx',
    'uppercase eyebrow labels inside a Card ("What you get" / "What it does not cover")',
  ],
  [
    'employer/(app)/role/edit/page.tsx',
    'two inline notices that use h2 for document structure rather than as page sections',
  ],
]);
const ROOTS = [join(import.meta.dirname, '..', 'app'), join(import.meta.dirname, '..', 'src')];

interface Heading {
  file: string;
  text: string;
  size: string;
}

const headings: Heading[] = [];
for (const root of ROOTS) {
  for await (const entry of glob('**/*.tsx', { cwd: root })) {
    const file = join(root, entry);
    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(/<h2[^>]*className="([^"]*)"[^>]*>([^<{]*)/g)) {
      const size = /\btext-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl)\b/.exec(m[1] ?? '')?.[0];
      if (!size) continue; // inherits: a Card title, covered by the comment above
      headings.push({
        file: entry.replace(/\\/g, '/'),
        text: (m[2] ?? '').trim().slice(0, 40),
        size,
      });
    }
  }
}

describe('every h2 that states a size uses one from the scale', () => {
  it('found headings to check', () => {
    // Without this, a broken regex would make the suite pass by testing none.
    expect(headings.length).toBeGreaterThan(20);
  });

  it('uses no size outside text-2xl and text-xl', () => {
    const offenders = headings.filter(
      (h) => !ALLOWED.has(h.size) && !WRITTEN_DOWN_EXCEPTIONS.has(h.file),
    );
    expect(
      offenders.map((h) => `${h.file}: "${h.text}" is ${h.size}`),
      'a section heading at a size the documented scale does not contain. text-2xl sells on a ' +
        'marketing page, text-xl is an app or legal page, and a Card title states no size at all. ' +
        'If this h2 is genuinely not a section heading, add it to WRITTEN_DOWN_EXCEPTIONS with ' +
        'the reason rather than widening the scale.',
    ).toEqual([]);
  });

  it('keeps the exception list honest', () => {
    // An exception that no longer applies is a rule nobody is following any
    // more, so a stale entry has to fail rather than sit there permitting
    // something that has since been fixed.
    const filesWithOddSizes = new Set(
      headings.filter((h) => !ALLOWED.has(h.size)).map((h) => h.file),
    );
    const stale = [...WRITTEN_DOWN_EXCEPTIONS.keys()].filter((f) => !filesWithOddSizes.has(f));
    expect(stale, 'listed as an exception but no longer needs one').toEqual([]);
  });
});
