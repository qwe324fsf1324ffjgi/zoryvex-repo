import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FEATURE_FLAGS } from '@zoryvex/config';

/**
 * Guards a real, previously-recurring bug.
 *
 * `/zoryvex/<env>/feature-flags` is a single JSON document, so
 * `put-parameter --overwrite` replaces the WHOLE thing. The emergency
 * lockdown script used to write only the two flags it manages, silently
 * deleting `payments` and `publicDiscovery`.
 *
 * This is not theoretical: it is the recorded cause of a feature-flag drift
 * incident in this project, where the live parameter ended up holding a
 * two-key document contradicting the four-key one Terraform manages, and a
 * human had to spot it and repair it by hand.
 *
 * The failure mode is quiet in exactly the wrong way. `FeatureFlagsSchema`
 * gives every flag `.default(false)`, so a truncated document still parses
 * cleanly — nothing errors, the keys simply cease to exist.
 */

const root = join(import.meta.dirname, '..', '..');
const source = readFileSync(join(root, 'scripts', 'emergency-cost-lockdown.mjs'), 'utf8');

describe('emergency lockdown writes a complete flag document', () => {
  it('knows about every flag the schema defines', () => {
    // If a flag is ever added to FeatureFlagsSchema, this fails until the
    // lockdown script is taught about it — which is the whole point.
    for (const flag of Object.keys(DEFAULT_FEATURE_FLAGS)) {
      expect(source, `lockdown script does not mention the "${flag}" flag`).toContain(flag);
    }
  });

  it('defines an all-off fallback covering exactly the schema keys', () => {
    const match = /const ALL_FLAGS_OFF = \{([\s\S]*?)\};/.exec(source);
    expect(match, 'ALL_FLAGS_OFF is missing').not.toBeNull();

    const declared = [...match[1].matchAll(/(\w+):\s*false/g)].map((m) => m[1]).sort();
    expect(declared).toEqual(Object.keys(DEFAULT_FEATURE_FLAGS).sort());
  });

  it('writes the merged document, never the two-key lockdown values directly', () => {
    // The original bug in one line: JSON.stringify(LOCKDOWN_FLAG_VALUES)
    // passed straight to put-parameter.
    expect(source).not.toMatch(/JSON\.stringify\(LOCKDOWN_FLAG_VALUES\)/);
    expect(source).toMatch(/JSON\.stringify\(lockdownFlagDocument\(env\)\)/);
  });

  it('still forces the two flags it owns last, so live values cannot override them', () => {
    // Spread order is load-bearing: defaults, then current, then the
    // lockdown values. If LOCKDOWN_FLAG_VALUES were not last, a live `true`
    // would survive a lockdown.
    expect(source).toMatch(
      /\{\s*\.\.\.ALL_FLAGS_OFF,\s*\.\.\.current,\s*\.\.\.LOCKDOWN_FLAG_VALUES\s*\}/,
    );
  });

  it('treats an unreadable parameter as all-off rather than aborting', () => {
    // A kill switch must not refuse to fire because a read failed.
    expect(source).toContain('fail-safe direction');
    expect(source).toMatch(/catch\s*\{[\s\S]*?ALL_FLAGS_OFF/);
  });
});
