import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkStateSchema } from '../check-state-schema.mjs';
import { assertSupportedSchema, validateDocument } from './state-schema.mjs';

/**
 * `.zoryvex/state.json` is what a resume trusts before it trusts anything
 * else, and the schema next to it had never been enforced by anything. These
 * cover the validator itself; the last block covers the real file, which is
 * the reason the validator exists.
 */

const root = join(import.meta.dirname, '..', '..');

/** A small stand-in for the real schema, using only the keywords it uses. */
const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['phase', 'cumulativeGoalTurnCount', 'checks'],
  properties: {
    phase: { type: 'string' },
    cumulativeGoalTurnCount: { type: 'integer', minimum: 0 },
    goalTurnLimit: { const: 12 },
    upstream: { type: ['string', 'null'] },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'status'],
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          status: { enum: ['PASS', 'WARN', 'BLOCKED', 'PENDING'] },
        },
      },
    },
  },
};

const valid = {
  phase: '7',
  cumulativeGoalTurnCount: 3,
  goalTurnLimit: 12,
  upstream: null,
  checks: [{ name: 'baseline tests', status: 'PASS' }],
};

describe('validateDocument', () => {
  it('passes a valid document', () => {
    expect(validateDocument(valid, schema)).toEqual([]);
  });

  it('fails a missing required property, naming it', () => {
    const withoutPhase = { ...valid };
    delete withoutPhase.phase;
    const [problem, ...rest] = validateDocument(withoutPhase, schema);
    expect(problem).toContain('missing required property "phase"');
    expect(rest).toEqual([]);
  });

  it('fails a wrong type, naming the path and both types', () => {
    const [problem] = validateDocument({ ...valid, cumulativeGoalTurnCount: '3' }, schema);
    expect(problem).toContain('.cumulativeGoalTurnCount');
    expect(problem).toContain('expected integer');
    expect(problem).toContain('got string');
  });

  it('names the path through an array, not just the array', () => {
    const document = { ...valid, checks: [{ name: 'baseline tests', status: 'GREEN' }] };
    const [problem] = validateDocument(document, schema);
    expect(problem).toContain('.checks[0].status');
    expect(problem).toContain('"GREEN" is not one of');
  });

  it('separates a whole number from a fractional one', () => {
    expect(validateDocument({ ...valid, cumulativeGoalTurnCount: 2.5 }, schema)).toHaveLength(1);
    expect(validateDocument({ ...valid, cumulativeGoalTurnCount: 0 }, schema)).toEqual([]);
  });

  it('accepts either branch of a nullable type', () => {
    expect(validateDocument({ ...valid, upstream: 'origin/main' }, schema)).toEqual([]);
    expect(validateDocument({ ...valid, upstream: 4 }, schema)).toHaveLength(1);
  });

  it('rejects a property the schema does not declare', () => {
    const [problem] = validateDocument({ ...valid, phse: '7' }, schema);
    expect(problem).toContain('unexpected property "phse"');
  });

  it('reports a below-minimum count and a wrong const', () => {
    const problems = validateDocument(
      { ...valid, cumulativeGoalTurnCount: -1, goalTurnLimit: 20 },
      schema,
    );
    expect(problems).toHaveLength(2);
    expect(problems.join('\n')).toContain('below the minimum of 0');
    expect(problems.join('\n')).toContain('expected 12, got 20');
  });

  it('reports every problem at once rather than stopping at the first', () => {
    const problems = validateDocument({ phase: 7, checks: [] }, schema);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('missing required property "cumulativeGoalTurnCount"');
    expect(problems[1]).toContain('.phase: expected string, got integer');
  });
});

describe('assertSupportedSchema', () => {
  /**
   * The validator implements a subset. If the schema gains a keyword it does
   * not know, the honest outcome is a loud failure — a skipped keyword would
   * read as a tightened schema while constraining nothing, which is the exact
   * silent no-op this check was added to prevent.
   */
  it('throws on a keyword the validator does not implement', () => {
    const withPattern = {
      type: 'object',
      properties: { phase: { type: 'string', pattern: '^[0-9]+$' } },
    };
    expect(() => assertSupportedSchema(withPattern)).toThrow(/Unsupported.*"pattern".*\.phase/s);
  });

  it('finds an unsupported keyword nested inside array items', () => {
    const withMaxLength = {
      type: 'array',
      items: { type: 'object', properties: { name: { type: 'string', maxLength: 10 } } },
    };
    expect(() => assertSupportedSchema(withMaxLength)).toThrow(/"maxLength"/);
  });

  it('accepts the schema the repository actually ships', () => {
    const real = JSON.parse(readFileSync(join(root, '.zoryvex', 'state.schema.json'), 'utf8'));
    expect(() => assertSupportedSchema(real)).not.toThrow();
  });
});

describe('the state file this repository ships', () => {
  it('matches its own schema', () => {
    // The check `npm run state:check` runs, asserted here too so a broken
    // state file fails the unit suite rather than only the validate chain.
    expect(checkStateSchema({ root })).toEqual([]);
  });
});
