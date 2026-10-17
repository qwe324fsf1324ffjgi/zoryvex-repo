import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { byStrongestMatch, type Match } from '@zoryvex/contracts';

/**
 * The order a shortlist is read in must have exactly one definition.
 *
 * It had two. The API ranked matches by how well a candidate answered what
 * the role asked for, keeping somebody outside the role's countries or
 * hours in the list but below the people who could actually be hired. The
 * employer's role page then re-sorted the same array in the browser, by
 * score and evidence strength alone, and that sort ran last. So the rule
 * the server applied reached nobody: the page showed a candidate in the
 * wrong country above a hireable one, exactly the thing the server had
 * been changed to prevent.
 *
 * Nothing failed. Both sorts were correct on their own terms, both were
 * tested, and neither test could see the other. The only durable fix is
 * one definition, so this pins that rather than the wording of either.
 */

const WEB_ROOT = join(__dirname, '..');
const SKIP = new Set(['node_modules', '.next', 'out', 'tests', 'dist']);

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

describe('match ordering has one definition', () => {
  it('is imported from contracts by the page that shows a shortlist', () => {
    const page = readFileSync(join(WEB_ROOT, 'app/employer/(app)/role/page.tsx'), 'utf8');

    expect(page).toContain('byStrongestMatch');
    expect(page).toMatch(/byStrongestMatch[\s\S]*?from '@zoryvex\/contracts'/);
  });

  it('is not re-implemented anywhere in the web app', () => {
    // A comparator that reaches for matchScore is the shape the second
    // copy took, and the shape any future copy would take.
    const offenders = sourceFiles(WEB_ROOT).filter((file) => {
      const text = readFileSync(file, 'utf8');
      return /\.sort\(/.test(text) && /matchScore/.test(text);
    });

    expect(offenders.map((f) => f.slice(WEB_ROOT.length + 1))).toEqual([]);
  });
});

/**
 * The behaviour that ordering exists to produce, stated from the
 * employer's side: the person they can actually hire is at the top.
 */
describe('what an employer sees first', () => {
  const match = (candidateId: string, matchScore: number, fit?: Match['fit']) =>
    ({ candidateId, matchScore, ...(fit ? { fit } : {}) }) as unknown as Match;

  it('puts a candidate who fits the role above one with broader proof who does not', () => {
    const ranked = byStrongestMatch([
      match('cand_wrong_country', 0.95, 'partial'),
      match('cand_hireable', 0.4, 'meets'),
    ]);

    expect(ranked[0]?.candidateId).toBe('cand_hireable');
  });

  it('keeps the one who does not fit on the list, below rather than gone', () => {
    const ranked = byStrongestMatch([
      match('cand_wrong_country', 0.95, 'partial'),
      match('cand_hireable', 0.4, 'meets'),
    ]);

    expect(ranked.map((m) => m.candidateId)).toEqual(['cand_hireable', 'cand_wrong_country']);
  });
});
