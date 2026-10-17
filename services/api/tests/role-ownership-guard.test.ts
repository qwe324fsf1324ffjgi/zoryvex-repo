import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every domain function that takes an employer's id and a role id must
 * compare them before touching the role.
 *
 * The two halves of this codebase's authorization model are not
 * interchangeable. A candidate's resources are addressed by a composite
 * key whose partition is the candidate — `Key: key(candidateId,
 * evidenceId)` — so another candidate's row is not found rather than
 * refused, and ownership is enforced by the shape of the read itself.
 *
 * A role is different. `roleId` arrives in the URL, the caller chooses it,
 * and `getRole(roleId)` will happily return somebody else's role. The only
 * thing standing between an employer and a competitor's shortlist,
 * matches, Kit and pay data is an explicit comparison in the domain
 * function. Every one currently has it; this makes it impossible to add
 * one that does not, because the UI never being able to send that request
 * is not a defence against a direct API call.
 */

const domainDir = join(__dirname, '..', 'src', 'domain');

/**
 * The body of an exported async function.
 *
 * The opening brace is the last one on the signature's final line, not the
 * first after the parameters: a return type like `Promise<{ role: Role }>`
 * contains a brace too, and starting there reads the type instead of the
 * body. An earlier version of this scan made exactly that mistake and
 * reported every ownership check in the codebase as missing.
 */
function exportedFunctions(src: string): { name: string; signature: string; body: string }[] {
  const found: { name: string; signature: string; body: string }[] = [];
  const re = /export async function (\w+)\(/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(src))) {
    let i = src.indexOf('(', m.index);
    let parens = 0;
    for (; i < src.length; i += 1) {
      if (src[i] === '(') parens += 1;
      else if (src[i] === ')') {
        parens -= 1;
        if (parens === 0) break;
      }
    }
    const lineEnd = src.indexOf('\n', i);
    const start = src.lastIndexOf('{', lineEnd);
    if (start === -1 || start < i) continue;

    let depth = 0;
    let end = start;
    for (let j = start; j < src.length; j += 1) {
      if (src[j] === '{') depth += 1;
      else if (src[j] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    found.push({
      name: m[1] ?? '',
      signature: src.slice(m.index, start),
      body: src.slice(start, end),
    });
  }
  return found;
}

/** Compares an owner id against the acting employer, however it is spelled. */
const CHECKS_OWNER = [
  /employerId\s*!==\s*employerId/,
  /\.employerId\s*!==\s*\w+/,
  /\w+\s*!==\s*\w*\.?employerId/,
];

describe('a role can only be reached by the employer that owns it', () => {
  const offenders: string[] = [];

  for (const file of readdirSync(domainDir).filter((f) => f.endsWith('.ts'))) {
    const src = readFileSync(join(domainDir, file), 'utf8');
    for (const fn of exportedFunctions(src)) {
      const takesBoth =
        /\bemployerId\s*:\s*string/.test(fn.signature) &&
        /\broleId\s*:\s*string/.test(fn.signature);
      if (!takesBoth) continue;

      // Only functions that actually load the role need the comparison.
      // One that merely passes both ids down to another domain function
      // is checked where the read happens.
      if (!/getRole\(/.test(fn.body)) continue;

      if (!CHECKS_OWNER.some((pattern) => pattern.test(fn.body))) {
        offenders.push(`${file}: ${fn.name}`);
      }
    }
  }

  it('has no domain function that loads a role without checking the owner', () => {
    expect(offenders).toEqual([]);
  });

  /**
   * Proves the scan can actually fail. Without this, a regex that matches
   * nothing would report a clean result forever and the guard would be
   * decoration.
   */
  it('detects a function that loads a role and skips the check', () => {
    const bad = `
export async function readAnyRole(
  employerId: string,
  roleId: string,
  deps: Deps,
): Promise<{ role: Role }> {
  const found = await deps.getRole(roleId);
  if (!found) throw new NotFoundError('Role not found');
  return found;
}
`;
    const [fn] = exportedFunctions(bad);
    expect(fn?.name).toBe('readAnyRole');
    expect(CHECKS_OWNER.some((pattern) => pattern.test(fn!.body))).toBe(false);
  });

  it('accepts the real pattern the codebase uses', () => {
    const good = `
export async function getOwnRole(
  employerId: string,
  roleId: string,
  deps: Deps,
): Promise<{ role: Role; version: number }> {
  const result = await deps.getRole(roleId);
  if (!result || result.role.employerId !== employerId) throw new NotFoundError('Role not found');
  return result;
}
`;
    const [fn] = exportedFunctions(good);
    expect(CHECKS_OWNER.some((pattern) => pattern.test(fn!.body))).toBe(true);
  });
});
