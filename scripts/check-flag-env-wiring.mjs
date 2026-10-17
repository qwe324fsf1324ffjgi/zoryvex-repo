#!/usr/bin/env node
// Fails if a Lambda gates on a feature flag but its Terraform never tells it
// where the flags are.
//
// See scripts/lib/flag-env-wiring.mjs for why this is worth a check of its
// own: the flag read fails closed and silently, so the symptom is a feature
// that politely reports itself paused rather than anything that looks broken.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  findUnwiredModules,
  flagGatedExports,
  handlerGatesOnFlags,
  parseLambdaModules,
} from './lib/flag-env-wiring.mjs';

const root = join(import.meta.dirname, '..');
const domainDir = join(root, 'services/api/src/domain');
const handlersDir = join(root, 'services/api/handlers');
const environments = ['test', 'production'];

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.name.endsWith('.ts')) files.push(full);
  }
  return files;
}

function baseName(file) {
  return file.split('\\').join('/').split('/').pop().replace(/\.ts$/, '');
}

// Base module name to the set of its exported functions that read a flag.
const gatedByModule = {};
for (const file of walk(domainDir)) {
  const gated = flagGatedExports(readFileSync(file, 'utf8'));
  if (gated.size > 0) gatedByModule[baseName(file)] = gated;
}
const gatedFunctionCount = Object.values(gatedByModule).reduce((n, set) => n + set.size, 0);

/**
 * The bundle name Terraform uses for each handler file, read out of
 * scripts/build-lambda.mjs rather than derived from the path.
 *
 * Deriving it was wrong, and quietly: `handlers/matches/list-for-role.ts` is
 * bundled as `matches-list`, so a rule that turns directory separators into
 * dashes produces a name no route uses, and the two match routes with the
 * widest reach were silently exempt from this check.
 */
const bundleSource = readFileSync(join(root, 'scripts/build-lambda.mjs'), 'utf8');
const bundleEntries = [
  ...bundleSource.matchAll(/name:\s*'([a-z0-9-]+)'\s*,\s*entry:\s*join\(apiRoot,([^)]*)\)/g),
].map(([, name, args]) => ({
  name,
  file: join(handlersDir, ...[...args.matchAll(/'([^']+)'/g)].map((m) => m[1]).slice(1)),
}));

if (bundleEntries.length === 0) {
  console.error(
    'Flag wiring check: could not read the handler list out of scripts/build-lambda.mjs. ' +
      'Its shape must have changed. Fix the parse rather than trusting a pass.',
  );
  process.exit(1);
}

const gatedHandlerNames = new Set();
let gatedHandlerCount = 0;

for (const { name, file } of bundleEntries) {
  let source;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    console.error(`Flag wiring check: bundle "${name}" points at ${file}, which does not exist.`);
    process.exit(1);
  }
  if (!handlerGatesOnFlags(source, gatedByModule)) continue;
  gatedHandlerCount += 1;
  gatedHandlerNames.add(`handlers/${name}.handler`);
}

if (gatedFunctionCount === 0 || gatedHandlerCount === 0) {
  // Guards the check against itself. A parser that quietly matches nothing
  // would report a clean pass forever, which is the failure this whole file
  // exists to stop happening somewhere else.
  console.error(
    `Flag wiring check: found ${gatedFunctionCount} flag-gated domain functions and ` +
      `${gatedHandlerCount} handlers reaching them. Zero of either means this check has lost ` +
      'its way, not that the code is clean. Look at scripts/lib/flag-env-wiring.mjs.',
  );
  process.exit(1);
}

const failures = [];
let checked = 0;

for (const environment of environments) {
  const source = readFileSync(join(root, 'infrastructure/envs', environment, 'main.tf'), 'utf8');
  const modules = parseLambdaModules(source);
  checked += modules.filter((module) => gatedHandlerNames.has(module.handler)).length;

  for (const module of findUnwiredModules(modules, gatedHandlerNames)) {
    failures.push(
      `${environment}: module "${module.name}" (${module.handler}) gates on a feature flag but ` +
        `${module.problem}.`,
    );
  }
}

if (failures.length > 0) {
  console.error('Feature-flag env wiring check failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `Feature-flag env wiring check passed: ${gatedHandlerCount} flag-gated handlers, ` +
    `${checked} route declarations across ${environments.length} environments, all wired.`,
);
