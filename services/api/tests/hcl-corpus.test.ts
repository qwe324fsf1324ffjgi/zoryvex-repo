import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseHcl, type HclBlock } from '../src/lib/hcl';

/**
 * The HCL reader, run over every piece of real Terraform in this repository.
 *
 * Four bugs were found in this parser while the graded tasks were built, and
 * every one was found by writing a realistic submission rather than by a
 * fixture: a jsonencode body that ended its enclosing resource early, a
 * newline swallowed after a plain reference, a closing brace eaten on a
 * single-line block, and a bare reference inside a list consuming the list's
 * closing bracket.
 *
 * They share a failure mode, and it is the dangerous one. The parse does not
 * throw. It succeeds and quietly returns less, so a correct submission is
 * graded as though half of it were missing and the candidate is told they
 * failed requirements they actually met. No fixture catches that, because a
 * fixture only contains the shapes its author thought of.
 *
 * This does. `infrastructure/` holds 70+ files of production Terraform
 * nobody wrote with a parser in mind: modules, environments, IAM policy
 * documents, nested dynamic configuration. The oracle is that in a
 * `terraform fmt`-clean file every top-level block starts at column 0, so
 * the source itself says how many there should be.
 *
 * Restoring the bracket bug makes this fail with 104 losses across 95
 * top-level blocks and 25 nested attributes, which is how it is known to be
 * measuring something rather than passing vacuously.
 */

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');
const TOP_LEVEL = /^(resource|data|module|variable|output|locals|provider|terraform)\b/;
const LABELLED = /^(resource|data|module|variable|output) "?([A-Za-z0-9_.-]+)"?(?: "([^"]+)")?/;

function tfFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    // .terraform holds vendored providers and cached modules, none of it ours.
    if (entry === '.terraform' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) tfFiles(full, out);
    else if (entry.endsWith('.tf')) out.push(full);
  }
  return out;
}

function countAttrDeep(blocks: HclBlock[], name: string): number {
  let n = 0;
  const walk = (b: HclBlock) => {
    if (b.attributes[name] !== undefined) n += 1;
    b.blocks.forEach(walk);
  };
  blocks.forEach(walk);
  return n;
}

const files = tfFiles(join(REPO_ROOT, 'infrastructure'));

describe('the HCL reader against this repository’s own Terraform', () => {
  it('has a corpus worth testing against', () => {
    // Without this the whole suite would pass silently if the directory
    // moved, which is the same class of quiet failure it exists to catch.
    expect(files.length).toBeGreaterThan(50);
  });

  it('loses nothing: every top-level block in every file survives the parse', () => {
    const losses: string[] = [];
    let expectedTotal = 0;
    let foundTotal = 0;

    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const result = parseHcl(src);

      // One environment file is larger than a submission is ever allowed to
      // be. Refusing it is the size guard working, not a parse failure.
      if (result.refused) {
        expect(result.refused, file).toContain('larger than');
        continue;
      }

      const expected = src.split('\n').filter((l) => TOP_LEVEL.test(l));
      expectedTotal += expected.length;
      foundTotal += result.blocks.length;

      if (result.blocks.length !== expected.length) {
        losses.push(`${file}: ${result.blocks.length} blocks, expected ${expected.length}`);
      }

      for (const line of expected) {
        const m = LABELLED.exec(line);
        if (!m) continue;
        const survived = result.blocks.some(
          (b) =>
            b.type === m[1] && b.labels[0] === m[2] && (m[3] === undefined || b.labels[1] === m[3]),
        );
        if (!survived) losses.push(`${file}: lost ${m[1]} ${m[2]}${m[3] ? '.' + m[3] : ''}`);
      }
    }

    expect(losses.slice(0, 10)).toEqual([]);
    expect(foundTotal).toBe(expectedTotal);
    expect(foundTotal).toBeGreaterThan(400);
  });

  it('loses nothing nested either, not just the roots', () => {
    // Top-level counts cannot see a bug that only loses deep content. This
    // repository's IAM policy documents are full of `sid` at depth, so
    // counting them proves the tree survived rather than merely its roots.
    let expectedTotal = 0;
    let foundTotal = 0;
    const losses: string[] = [];

    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const result = parseHcl(src);
      if (result.refused) continue;

      const expected = (src.match(/^\s+sid\s*=\s*"/gm) ?? []).length;
      const found = countAttrDeep(result.blocks, 'sid');
      expectedTotal += expected;
      foundTotal += found;
      if (found !== expected) losses.push(`${file}: ${found} sids, expected ${expected}`);
    }

    expect(losses).toEqual([]);
    expect(foundTotal).toBe(expectedTotal);
    expect(foundTotal).toBeGreaterThan(30);
  });

  it('never throws and never hangs on any real file', () => {
    const started = Date.now();
    for (const file of files) {
      expect(() => parseHcl(readFileSync(file, 'utf8')), file).not.toThrow();
    }
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});
