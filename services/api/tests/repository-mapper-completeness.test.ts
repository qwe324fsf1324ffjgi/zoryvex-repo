import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as contracts from '@zoryvex/contracts';

/**
 * No repository may read back less than it stored.
 *
 * This is the fifth time the same defect has been found, in five different
 * files, and every instance looked identical: a mapper spells out the
 * fields it copies off a DynamoDB item, the schema later gains a field,
 * nobody adds it to the list, and because the new field is optional or has
 * a default the parse keeps succeeding. Nothing throws. The typechecker is
 * satisfied, because the object really does match the type. The field is
 * written on save and discarded on load.
 *
 * What it has cost so far: a candidate's phone number and links, which
 * also meant an employer who paid for a contact unlock received an email
 * address and nothing else; a match's `fit`, `fitReason` and both interest
 * states, which meant fit-first ranking never ran in production; and an
 * entitlement's `priceNGN` and `foundingMember`, which is the figure
 * behind the promise that a founding member keeps their price.
 *
 * The individual round-trip tests pin the mappers that were fixed. This
 * pins the shape of the mistake, for every repository at once and for
 * every field added from here on. It reads the source rather than calling
 * the mappers because they are module-private and sit behind an AWS
 * client, and because the thing being checked is a hand-written list —
 * which is visible in the text and nowhere else.
 */

const REPOSITORY_DIR = join(import.meta.dirname, '..', 'src', 'repositories');

/** Attributes that belong to the table, not to any schema. */
const TABLE_KEYS = new Set([
  'PK',
  'SK',
  'GSI1PK',
  'GSI1SK',
  'GSI2PK',
  'GSI2SK',
  'GSI3PK',
  'GSI3SK',
  'version',
  'ttl',
  'expiresAt',
]);

/**
 * Fields a read mapper leaves out on purpose, and why.
 *
 * A projection and the bug look identical in the source: both are a
 * hand-written list shorter than the schema. The difference is intent, and
 * intent has to be written down somewhere a test can see it, or the next
 * person to tidy the file for consistency turns a privacy boundary into a
 * leak with every test still green.
 *
 * The set is exact, not a minimum. Widening a projection means editing
 * this list, which is a visible decision in a diff; and a field added to
 * the schema and forgotten in the mapper still fails here, because it was
 * not in the set.
 */
const INTENTIONAL_PROJECTIONS: Record<string, { fields: string[]; because: string }> = {
  'admin-repository.ts:CandidateSchema': {
    fields: [
      'contactUnlockConsent',
      'phone',
      'linkedinUrl',
      'websiteUrl',
      'location',
      'publicProofId',
      'intent',
    ],
    because:
      'The founder console counts and moderates accounts. Contact channels, location and ' +
      'what somebody will work for are released through the paid contact-unlock route only, ' +
      'and only while the candidate consent stands.',
  },
};

interface MapperLiteral {
  file: string;
  schemaName: string;
  /** The keys the literal assigns, e.g. `id: item.id` contributes `id`. */
  assigned: Set<string>;
  /** True when the whole item is passed instead of a hand-written list. */
  spread: boolean;
  /**
   * True when the literal is built from a stored item rather than from
   * caller input. Only these are read mappers: a create path legitimately
   * omits a field nobody has filled in yet, and checking it would produce
   * noise that trains people to ignore this test.
   */
  fromStoredItem: boolean;
  line: number;
}

/**
 * Finds every `XSchema.parse(...)` call and records what it was handed.
 *
 * Deliberately simple: it walks braces from the call's opening paren, so a
 * nested object (a location, an intent) is skipped rather than mistaken
 * for a top-level field. A call whose argument is not an object literal is
 * recorded as a spread, which is the safe form.
 */
function findMapperLiterals(source: string, file: string): MapperLiteral[] {
  const found: MapperLiteral[] = [];
  const call = /\b([A-Z]\w*Schema)\.parse\(/g;
  let match: RegExpExecArray | null;

  while ((match = call.exec(source)) !== null) {
    const open = call.lastIndex;
    const line = source.slice(0, match.index).split('\n').length;
    if (source[open] !== '{') {
      found.push({
        file,
        schemaName: match[1]!,
        assigned: new Set(),
        spread: true,
        fromStoredItem: true,
        line,
      });
      continue;
    }

    let depth = 0;
    let end = open;
    for (; end < source.length; end += 1) {
      const ch = source[end];
      if (ch === '{' || ch === '[' || ch === '(') depth += 1;
      else if (ch === '}' || ch === ']' || ch === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const body = source.slice(open + 1, end);

    const assigned = new Set<string>();
    let depthInBody = 0;
    for (const rawLine of body.split('\n')) {
      const trimmed = rawLine.trim();
      if (depthInBody === 0) {
        const key = /^([A-Za-z_]\w*)\s*:/.exec(trimmed);
        if (key) assigned.add(key[1]!);
        const shorthand = /^([A-Za-z_]\w*)\s*,?$/.exec(trimmed);
        if (shorthand) assigned.add(shorthand[1]!);
      }
      for (const ch of rawLine) {
        if (ch === '{' || ch === '[' || ch === '(') depthInBody += 1;
        else if (ch === '}' || ch === ']' || ch === ')') depthInBody -= 1;
      }
    }

    found.push({
      file,
      schemaName: match[1]!,
      assigned,
      spread: body.includes('...'),
      // A read mapper reads `item.x`; a constructor reads `input.x`.
      fromStoredItem: /[^A-Za-z]item[.?]/.test(body) || /result[.?]Item/.test(body),
      line,
    });
  }
  return found;
}

function schemaFields(name: string): string[] | null {
  const schema = (contracts as Record<string, unknown>)[name];
  if (!schema || typeof schema !== 'object') return null;
  const shape = (schema as { shape?: Record<string, unknown> }).shape;
  if (!shape) return null;
  return Object.keys(shape);
}

const literals = readdirSync(REPOSITORY_DIR)
  .filter((f) => f.endsWith('.ts'))
  .flatMap((f) => findMapperLiterals(readFileSync(join(REPOSITORY_DIR, f), 'utf8'), f));

describe('repository mappers copy every field their schema defines', () => {
  /** If this finds nothing the check below is vacuous, which is how a guard rots. */
  it('found the mapper calls to check', () => {
    expect(literals.length).toBeGreaterThan(8);
    expect(literals.some((l) => l.file === 'role-repository.ts')).toBe(true);
    expect(literals.some((l) => l.file === 'candidate-repository.ts')).toBe(true);
  });

  it('found read mappers and told them apart from create paths', () => {
    const read = literals.filter((l) => l.fromStoredItem && !l.spread);
    const created = literals.filter((l) => !l.fromStoredItem);
    expect(read.length).toBeGreaterThan(4);
    expect(created.some((l) => l.file === 'candidate-repository.ts')).toBe(true);
  });

  it('resolves every schema it found to a real shape', () => {
    const unresolved = literals
      .filter((l) => !l.spread)
      .filter((l) => schemaFields(l.schemaName) === null)
      .map((l) => `${l.file}:${l.line} ${l.schemaName}`);
    expect(unresolved).toEqual([]);
  });

  it('leaves no schema field out of a hand-written mapper', () => {
    const gaps: string[] = [];

    for (const literal of literals) {
      if (literal.spread || !literal.fromStoredItem) continue;
      const fields = schemaFields(literal.schemaName);
      if (!fields) continue;

      const projection = INTENTIONAL_PROJECTIONS[`${literal.file}:${literal.schemaName}`];
      const allowed = new Set(projection?.fields ?? []);
      const missing = fields.filter(
        (field) => !literal.assigned.has(field) && !TABLE_KEYS.has(field) && !allowed.has(field),
      );
      if (missing.length > 0) {
        gaps.push(
          `${literal.file}:${literal.line} ${literal.schemaName} drops ${missing.join(', ')}`,
        );
      }
    }

    expect(gaps).toEqual([]);
  });

  /**
   * The other half of the projection rule. Listing a field here excuses it
   * from the check above, so a stale entry would quietly excuse a field
   * the mapper had started returning again.
   */
  it('keeps every declared projection real and exact', () => {
    const wrong: string[] = [];

    for (const [id, projection] of Object.entries(INTENTIONAL_PROJECTIONS)) {
      const [file, schemaName] = id.split(':');
      const literal = literals.find(
        (l) => l.file === file && l.schemaName === schemaName && l.fromStoredItem && !l.spread,
      );
      if (!literal) {
        wrong.push(`${id} is declared but no such hand-written read mapper exists`);
        continue;
      }
      const stillReturned = projection.fields.filter((field) => literal.assigned.has(field));
      if (stillReturned.length > 0) {
        wrong.push(`${id} is declared to withhold ${stillReturned.join(', ')}, and returns it`);
      }
      expect(projection.because.length).toBeGreaterThan(40);
    }

    expect(wrong).toEqual([]);
  });
});
