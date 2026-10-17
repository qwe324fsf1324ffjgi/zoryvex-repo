import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The billing page must receive every number it renders.
 *
 * `GET /billing` builds its quotes by hand, listing the fields it forwards.
 * One field was computed, typed, and documented as belonging in front of
 * the buyer before they pay — and left out of that list.
 * `marketplaceCandidates` never reached the browser, so the page rendered
 * "Your strongest role currently matches undefined candidates" to an
 * employer deciding whether to spend NGN 800,000 a month. Nothing threw:
 * the value is only read inside a template string, where `undefined`
 * becomes the word.
 *
 * This is the sixth field lost to a hand-written subset in this codebase,
 * and the first in a handler rather than a repository, which is why the
 * repository guard did not see it.
 *
 * One field is dropped on purpose. `planCode` is Paystack configuration
 * naming our own integration objects; the page gets `available` instead,
 * which is the same fact without the identifier. Declaring it here rather
 * than inferring it means widening the omission is a visible edit.
 */

const HANDLER = join(import.meta.dirname, '..', 'handlers', 'billing', 'overview.ts');
const SERVICE = join(import.meta.dirname, '..', 'src', 'domain', 'subscription-service.ts');

/** Field names of the `SubscriptionQuote` interface. */
function quoteFields(): string[] {
  const source = readFileSync(SERVICE, 'utf8');
  const start = source.indexOf('export interface SubscriptionQuote');
  expect(start, 'SubscriptionQuote should exist in subscription-service.ts').toBeGreaterThan(-1);
  const open = source.indexOf('{', start);

  let depth = 0;
  let end = open;
  for (; end < source.length; end += 1) {
    if (source[end] === '{') depth += 1;
    else if (source[end] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }

  const fields: string[] = [];
  let nesting = 0;
  for (const line of source.slice(open + 1, end).split('\n')) {
    const trimmed = line.trim();
    if (nesting === 0) {
      const key = /^([A-Za-z_]\w*)\??\s*:/.exec(trimmed);
      if (key) fields.push(key[1]!);
    }
    for (const ch of line) {
      if (ch === '{') nesting += 1;
      else if (ch === '}') nesting -= 1;
    }
  }
  return fields;
}

/** Field names the handler puts on each quote it returns. */
function forwardedFields(): string[] {
  const source = readFileSync(HANDLER, 'utf8');
  const start = source.indexOf('quotes: quotes.map(');
  expect(start, 'the handler should build its quotes by mapping').toBeGreaterThan(-1);
  const open = source.indexOf('({', start) + 1;

  let depth = 0;
  let end = open;
  for (; end < source.length; end += 1) {
    if (source[end] === '{') depth += 1;
    else if (source[end] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }

  return [...source.slice(open + 1, end).matchAll(/^\s*([A-Za-z_]\w*)\s*:/gm)].map((m) => m[1]!);
}

/**
 * Dropped deliberately, with the reason. Widening this means editing it,
 * which shows up in a diff.
 */
const DELIBERATELY_WITHHELD: Record<string, string> = {
  planCode:
    'Paystack configuration naming our own integration objects. The page is given `available` ' +
    'instead, which is the same fact without handing a browser an identifier it cannot use.',
};

describe('the billing overview forwards every field of the quote it built', () => {
  it('reads a real field list from both sides', () => {
    // A parser returning nothing would make the comparison below vacuous.
    expect(quoteFields()).toContain('amountNGN');
    expect(forwardedFields()).toContain('amountNGN');
  });

  it('forwards marketplaceCandidates, which the page renders into a sentence', () => {
    expect(forwardedFields()).toContain('marketplaceCandidates');
  });

  it('leaves out nothing except what is declared withheld', () => {
    const forwarded = new Set(forwardedFields());
    const missing = quoteFields().filter(
      (field) => !forwarded.has(field) && !(field in DELIBERATELY_WITHHELD),
    );
    expect(missing).toEqual([]);
  });

  it('keeps each declared omission real and explained', () => {
    const forwarded = new Set(forwardedFields());
    for (const [field, because] of Object.entries(DELIBERATELY_WITHHELD)) {
      expect(quoteFields(), `${field} is declared withheld but is not a quote field`).toContain(
        field,
      );
      expect(forwarded.has(field), `${field} is declared withheld and is forwarded`).toBe(false);
      expect(because.length).toBeGreaterThan(40);
    }
  });
});
