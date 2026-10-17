import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VERIFICATION_METHOD_FOR_SOURCE } from '@zoryvex/contracts';

/**
 * The homepage makes the product's central promise, and it drifted.
 *
 * Until 2026-09-05 it read: "Every candidate you see has had at least one
 * credential checked with the organization that issued it... Every check
 * links back to the issuer's own record."
 *
 * That was true of exactly one of the three verification methods.
 * `issuer_badge` is confirmed with the issuer. `repo_ownership` proves
 * control of an account, and `graded_task` is a practical task Zoryvex scores
 * itself; neither has an issuer or an issuer's record to link to. A candidate
 * verified solely by either made the sentence on the largest text on the site
 * false, and graded tasks are the fastest-growing of the three, so the claim
 * was becoming less true over time rather than more.
 *
 * Nothing caught it, because nothing could: no test compares marketing prose
 * to what the code guarantees, and the sentence was true when it was written.
 *
 * This is that comparison, in the only form that survives a rewrite. It does
 * not pin the wording, which should stay free to improve. It pins the
 * relationship: every verification method the product supports has to be
 * described on the page that claims what a buyer is getting, and the retired
 * overclaim must not come back.
 */

/**
 * What actually ships to a reader, which is the only thing worth asserting
 * against.
 *
 * Two transformations, both learned the hard way while writing this file.
 *
 * Comments are stripped first. The page carries a comment explaining what the
 * old overclaim was and quoting it, so the "this must not come back" check
 * matched the explanation of the fix rather than a live claim and failed on a
 * correct page. A guard that fires on its own documentation trains people to
 * delete the documentation.
 *
 * Whitespace is then collapsed, because JSX wraps prose at the print width
 * and a sentence the reader sees as one line arrives here with newlines and
 * indentation inside it. Matching the raw file would fail on a reformat,
 * which teaches people to delete the test rather than fix the claim.
 */
function shippedText(...segments: string[]): string {
  return readFileSync(join(import.meta.dirname, '..', ...segments), 'utf8')
    .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const HOMEPAGE = shippedText('app', '(marketing)', 'page.tsx');

/**
 * The same claim was on the paid subscription tiers, where it is worse: it
 * describes what somebody receives for a subscription costing hundreds of
 * thousands a month. Both surfaces are checked, because fixing one and
 * leaving the other is how this survived the first time.
 */
const PRICING = shippedText('src', 'lib', 'pricing.ts');

const SURFACES: Array<[string, string]> = [
  ['the homepage', HOMEPAGE],
  ['the subscription tiers', PRICING],
];

/**
 * What each method must be visible as. Deliberately a description a reader
 * would recognise rather than the enum value, because the enum value is
 * internal and never appears on the page.
 */
const MUST_DESCRIBE: Record<string, RegExp> = {
  // Either phrasing, because the two surfaces address different readers and
  // both sentences are true. The marketing page spells out "the body that
  // issued it" for somebody meeting the idea for the first time; the billing
  // tiers say "the issuer" to a buyer already reading a price list. What is
  // pinned is that the claim is present, not that the wording is identical,
  // because pinning the wording is how a guard ends up blocking a copy edit
  // that improved the page.
  issuer_badge: /confirmed with (?:the issuer|the body that issued it)/i,
  repo_ownership: /control of a (?:public )?repository/i,
};

/**
 * The methods a candidate can actually be verified by today, which is what
 * these pages are allowed to promise.
 *
 * Derived from VERIFICATION_METHOD_FOR_SOURCE rather than from the enum. The
 * enum still carries `graded_task` so evidence verified that way before
 * 2026-09-06 keeps parsing and keeps reading honestly on a profile, but no
 * claim type maps to it and nothing new can be verified that way. Iterating
 * the enum would demand these pages advertise a check the product no longer
 * runs, which is the same class of stale promise this file exists to catch,
 * pointing the other way.
 */
const OFFERED_METHODS = [
  ...new Set(Object.values(VERIFICATION_METHOD_FOR_SOURCE).filter((m) => m !== null)),
];

describe('the homepage promise matches what the product verifies', () => {
  it('covers every verification method the product supports', () => {
    for (const method of OFFERED_METHODS) {
      expect(
        MUST_DESCRIBE[method],
        `${method} is a verification method with no agreed description here. A new method means ` +
          'the homepage promise now covers something it does not describe, which is how the ' +
          'previous claim went stale. Add the wording to the page and the pattern here together.',
      ).toBeDefined();
      expect(
        HOMEPAGE,
        `the homepage no longer describes ${method}, so it promises less than the product does`,
      ).toMatch(MUST_DESCRIBE[method]!);
    }
  });

  it('has exactly the two methods these pages were written against', () => {
    // A third method is not a failure of the product, it is a signal that
    // these pages and this test both need a decision. Failing here is cheaper
    // than shipping a promise that quietly excludes somebody's proof.
    expect(OFFERED_METHODS).toHaveLength(2);
  });

  it('never advertises a check the product has retired', () => {
    // The other direction, and the one that was live for a few minutes while
    // graded tasks were being removed: prose outliving the feature it sells.
    for (const text of SURFACES.map(([, body]) => body)) {
      expect(text).not.toMatch(/task scored against a published rubric/i);
    }
  });

  it.each(SURFACES)('does not claim on %s that every check reaches an issuer', (_name, text) => {
    // The exact shapes of the retired overclaims, on both surfaces that
    // carried one. Two of the three methods have no issuer at all, so any
    // sentence generalising the issuer to every candidate is false again.
    expect(text).not.toMatch(/every candidate[^.]*checked with the organization that issued/i);
    expect(text).not.toMatch(/every check\s+links back to the issuer/i);
    expect(text).not.toMatch(/every candidate[^.]*at least one credential[^.]*with the issuer/i);
  });

  it('describes both methods on the subscription tiers too', () => {
    for (const [method, pattern] of Object.entries(MUST_DESCRIBE)) {
      expect(PRICING, `the paid tiers no longer describe ${method}`).toMatch(pattern);
    }
  });

  it('still says what a candidate has to have done to appear at all', () => {
    // matching-service drops any candidate with no verified evidence
    // supporting a requirement, so this half of the promise is enforced and
    // worth keeping visible.
    expect(HOMEPAGE).toMatch(/every candidate you see has passed at least one independent check/i);
  });
});
