import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards a promise the product made and then quietly stopped keeping.
 *
 * From 2026-08-27 the graded-task page told candidates "Nothing is recorded
 * against you for an attempt that did not pass." That was true when it was
 * written. On 2026-09-02 attempt recording shipped, and the same sentence
 * became a false statement: every attempt is now stored, and the employer
 * view shows which checks each one missed.
 *
 * Nothing caught it. No diff ever touched the sentence — the world moved
 * underneath it — and no test could compare a promise about behaviour to the
 * behaviour itself. It was found by a human reading the screen during a live
 * TEST run, which is the only thing that ever finds this class of defect.
 *
 * Consent is why it mattered rather than being a wording nit. A candidate read
 * that sentence, believed failure was private, and submitted on that basis; we
 * then showed the failure to employers. Consent obtained by a false statement
 * is not consent.
 *
 * What is testable is not "the copy is honest" — a machine cannot know that.
 * It is the specific retired claim, so that exact sentence cannot come back,
 * and the presence of a disclosure on the page that records the attempts.
 */
const WEB_ROOT = join(import.meta.dirname, '..');
const VERIFY_PAGE = join(WEB_ROOT, 'app', 'candidate', '(app)', 'evidence', 'verify', 'page.tsx');

/**
 * Phrasings that assert an attempt leaves no trace. Matched loosely on
 * purpose: the point is to catch the claim however somebody rewords it, not
 * to pin one sentence that a paraphrase would walk straight past.
 */
const RETIRED_CLAIMS = [
  /nothing is recorded against you/i,
  /not recorded (?:if|when|for) (?:it|an attempt|you)/i,
  /no record is kept of (?:a )?(?:failed|unsuccessful)/i,
  /(?:failed|unsuccessful) attempts? (?:are|is) not (?:kept|recorded|stored)/i,
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (entry === 'node_modules' || entry === '.next' || entry === 'out') return [];
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return ['.ts', '.tsx'].includes(extname(full)) ? [full] : [];
  });
}

describe('what candidates are told about attempt recording', () => {
  it('never tells anyone a failed attempt leaves no trace', () => {
    // Swept across the whole app, not just the page that had it. The claim
    // could reappear on a help page, an empty state, or marketing copy, and it
    // would be just as untrue there.
    const offenders: string[] = [];
    for (const file of sourceFiles(join(WEB_ROOT, 'app')).concat(
      sourceFiles(join(WEB_ROOT, 'src')),
    )) {
      const text = readFileSync(file, 'utf8');
      for (const claim of RETIRED_CLAIMS) {
        if (claim.test(text)) offenders.push(`${file.replace(WEB_ROOT, '')} :: ${claim}`);
      }
    }
    expect(offenders, `a retired claim is back:\n${offenders.join('\n')}`).toEqual([]);
  });

  /**
   * The two tests that used to live here checked a disclosure about graded
   * submissions: that every attempt was recorded, that an employer could see
   * that history, and that the submitted code itself was never stored. They
   * were right, and they are retired rather than deleted quietly.
   *
   * Graded tasks stopped being a way to become verified on 2026-09-06,
   * because a published brief marked against a published rubric is solved by
   * pasting the brief into a language model - so the mark said nothing about
   * the candidate. No claim type maps to `graded_task` any more, the page no
   * longer takes a submission, and nothing new is written to attempt history.
   * A disclosure about something that cannot happen is not honesty, it is
   * clutter that makes the honest disclosures harder to find.
   *
   * The sweep above still runs, and is the part that mattered: nothing
   * anywhere in the app may tell somebody an attempt leaves no trace.
   */
  it('no longer asks for a graded submission at all', () => {
    // Asserted on what the page renders, not on whether the words appear:
    // the file explains in a comment why graded tasks were retired, and that
    // explanation should survive.
    const page = readFileSync(VERIFY_PAGE, 'utf8');
    expect(page).not.toMatch(/GradedTaskOffer/);
    expect(page).not.toMatch(/setSubmission|chosenTaskId|offerState/);
    expect(page).not.toMatch(/getGradedTasks/);
  });

  it('still offers the two checks that do run', () => {
    // Retiring one route must not quietly take the others with it.
    const page = readFileSync(VERIFY_PAGE, 'utf8');
    expect(page).toMatch(/issuer_badge/);
    expect(page).toMatch(/repo_ownership/);
    expect(page).toMatch(/Run the check/);
  });
});
