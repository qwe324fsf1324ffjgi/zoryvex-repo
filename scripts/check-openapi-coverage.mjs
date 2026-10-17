#!/usr/bin/env node
// Fails when the OpenAPI contract and the deployed route table disagree.
//
// Checked against `test`, which is the environment that has every route.
// Production's own divergence from test is a separate, deliberate thing
// (see infrastructure/envs/production/main.tf on scheduled jobs) and is
// covered by scripts/check-gsi-grants.mjs rather than here.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  compareRoutes,
  describeCoverage,
  routesFromSpec,
  routesFromTerraform,
} from './lib/openapi-coverage.mjs';

const ROOT = join(import.meta.dirname, '..');

export function auditCoverage({ root = ROOT } = {}) {
  const deployed = routesFromTerraform(
    readFileSync(join(root, 'infrastructure', 'envs', 'test', 'main.tf'), 'utf8'),
  );
  const documented = routesFromSpec(
    readFileSync(join(root, 'packages', 'contracts', 'openapi.yaml'), 'utf8'),
  );
  return compareRoutes({ deployed, documented });
}

function main() {
  const result = auditCoverage();
  const text = describeCoverage(result);

  if (result.undocumented.length === 0 && result.imaginary.length === 0) {
    console.log(text);
    process.exit(0);
  }

  console.error(text);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
