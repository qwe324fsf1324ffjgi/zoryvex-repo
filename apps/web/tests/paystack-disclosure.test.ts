import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAYSTACK_BUSINESS_NAME, PAYSTACK_DISCLOSURE } from '../src/lib/pricing';

/**
 * The disclosure names the business that will appear on the customer's bank
 * statement, so it is only correct if it matches the Paystack account. It did
 * not. From 2026-08-15 to 2026-09-01 every surface said "Abbas Solution"
 * while the account read "Abba's Solutions", because the Phase 1 dashboard
 * survey misread it and everything downstream copied the record rather than
 * the dashboard.
 *
 * The existing parity test did not catch it and could not have: it compared
 * our string to our own OpenAPI file, and both were wrong together. A parity
 * guard proves the repository agrees with itself, never that it agrees with
 * the world outside it. Only the founder could catch this one, and did.
 *
 * What is testable is the shape of the mistake, which is a second copy of the
 * name written by hand. Two of the eight surfaces had one.
 */
const WEB_ROOT = join(import.meta.dirname, '..');
const SEARCH_ROOTS = ['app', 'src'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);

/** Where the name is allowed to be written out, because it is declared there. */
const DECLARATION = join('src', 'lib', 'pricing.ts');

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path));
    else if (SOURCE_EXTENSIONS.has(extname(entry))) found.push(path);
  }
  return found;
}

describe('the Paystack disclosure', () => {
  it('names the business exactly as the Paystack account does', () => {
    // Founder-confirmed against the dashboard on 2026-09-01. If the account
    // is ever renamed this assertion is the thing that has to change first.
    expect(PAYSTACK_BUSINESS_NAME).toBe("Abba's Solutions");
  });

  it('is the wording CLAUDE.md fixes, with that name in it', () => {
    expect(PAYSTACK_DISCLOSURE).toBe(
      "Payments are securely processed by Paystack under our business name, Abba's Solutions.",
    );
  });

  /**
   * The name guard above passed for twelve days while the footer was wrong.
   *
   * `SiteFooter` imported `PAYSTACK_BUSINESS_NAME` exactly as intended and
   * then hand-wrote the sentence around it: "Payments, when enabled, are
   * securely processed by...". The hedge was honest when payments were off
   * and became false on 2026-09-11, when production went live on live keys
   * and the pricing page above it started selling at real prices. A buyer
   * was being told, on the page where they pay, that payments might not be
   * enabled.
   *
   * So the name was never the whole risk. A surface can import the constant
   * for the one word that is guarded and rewrite the sentence that carries
   * it, which is what happened. This pins the sentence the same way.
   */
  it('has its wording written out in exactly one place', () => {
    const FRAGMENT = 'securely processed by Paystack';
    const offenders: string[] = [];
    for (const root of SEARCH_ROOTS) {
      for (const path of sourceFiles(join(WEB_ROOT, root))) {
        const relative = path.slice(WEB_ROOT.length + 1);
        if (relative === DECLARATION) continue;
        if (readFileSync(path, 'utf8').replace(/\s+/g, ' ').includes(FRAGMENT)) {
          offenders.push(relative);
        }
      }
    }
    expect(offenders, 'render PAYSTACK_DISCLOSURE instead of rewriting the sentence').toEqual([]);
  });

  it('is not written out by hand anywhere else in the web app', () => {
    const offenders: string[] = [];
    for (const root of SEARCH_ROOTS) {
      for (const path of sourceFiles(join(WEB_ROOT, root))) {
        const relative = path.slice(WEB_ROOT.length + 1);
        if (relative === DECLARATION) continue;
        const source = readFileSync(path, 'utf8');
        // Ignore whitespace so a line the formatter wrapped still counts.
        if (source.replace(/\s+/g, ' ').includes(PAYSTACK_BUSINESS_NAME)) {
          offenders.push(relative);
        }
      }
    }
    expect(offenders, `import PAYSTACK_BUSINESS_NAME instead of retyping it`).toEqual([]);
  });
});
