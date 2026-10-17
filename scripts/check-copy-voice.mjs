#!/usr/bin/env node
// Fails when product copy breaks the voice rules CLAUDE.md declares durable.
//
// Static and offline. Scoped to the files a user's words actually come from:
// the two apps' pages and components, the shared pricing/marketing copy, and
// the Kit templates, whose output an employer reads as a paid deliverable.
//
// Everything else is out of scope on purpose. These are rules about how the
// product speaks, not about how the repository documents itself.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describeVoiceViolations, findVoiceViolations } from './lib/copy-voice.mjs';

const ROOT = join(import.meta.dirname, '..');

const SCOPE = [
  join('apps', 'web', 'app'),
  join('apps', 'web', 'src', 'components'),
  join('apps', 'web-safe-shell', 'app'),
  join('packages', 'kit-templates', 'src'),
];

/**
 * Individual files that hold copy a person reads, outside the page trees.
 *
 * The first version of this scope was the two apps and the Kit templates,
 * which missed the largest body of candidate-facing prose in the product:
 * thirty graded-task briefs, and every rubric line telling a candidate what
 * was missing and why it matters. A candidate reads more words from
 * `graded-task-service.ts` than from any marketing page. `verification-
 * service.ts` holds the sentences shown when a verification fails, which is
 * the worst moment to sound like a machine, and the two composition files
 * plus the SES repository hold what an email actually says.
 */
const SCOPED_FILES = [
  join('apps', 'web', 'src', 'lib', 'pricing.ts'),
  join('services', 'api', 'src', 'domain', 'graded-task-service.ts'),
  join('services', 'api', 'src', 'domain', 'verification-service.ts'),
  join('services', 'api', 'src', 'composition', 'aws-auth-dependencies.ts'),
  join('services', 'api', 'src', 'composition', 'aws-verification-reminder-dependencies.ts'),
  join('services', 'api', 'src', 'repositories', 'ses-repository.ts'),
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|mjs)$/.test(entry) && !/\.test\./.test(entry)) out.push(full);
  }
  return out;
}

export function auditCopy({ root = ROOT } = {}) {
  const files = [];
  for (const dir of SCOPE) {
    try {
      walk(join(root, dir), files);
    } catch {
      // A scoped directory that does not exist is not a failure; the safe
      // shell has been added and removed before.
    }
  }
  for (const file of SCOPED_FILES) files.push(join(root, file));

  const violations = [];
  for (const file of files) {
    violations.push(
      ...findVoiceViolations(readFileSync(file, 'utf8'), {
        file: relative(root, file).replaceAll('\\', '/'),
      }),
    );
  }
  return { violations, fileCount: files.length };
}

function main() {
  const { violations, fileCount } = auditCopy();
  if (violations.length === 0) {
    console.log(`${describeVoiceViolations(violations)} (${fileCount} files scanned)`);
    process.exit(0);
  }
  console.error(describeVoiceViolations(violations));
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
