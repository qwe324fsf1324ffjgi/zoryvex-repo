#!/usr/bin/env node
// Fails when a Lambda queries a DynamoDB global secondary index that its own
// Terraform block does not grant it.
//
// Static and offline — no AWS call, no credentials. It reads the handler
// sources and the environment's main.tf, which is why it can run in the
// validate job alongside the other checks rather than waiting for a deploy.
//
// See scripts/lib/gsi-grant-check.mjs for why this exists: the same defect
// has reached TEST twice, and each time it was found by a live acceptance
// attempt failing rather than by anything in CI.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HANDLERS } from './build-lambda.mjs';
import { auditGsiGrants, describeGsiFindings } from './lib/gsi-grant-check.mjs';

const ROOT = join(import.meta.dirname, '..');
const ENVIRONMENTS = ['test', 'production'];

// Bundles an environment is deliberately built without, so their absence
// reads as a decision rather than as drift.
//
// Production has no scheduled jobs at all, and that is the same boundary
// infrastructure/envs/production/main.tf already draws for test's
// health-check scheduler: Prompt 7 enables only signed-launch-mode jobs, and
// no launch mode has been selected. The verification reminder is also the
// one thing in this system that emails somebody who did not ask for it,
// which is not something to leave sitting in production configuration ahead
// of the decision to switch it on.
const DELIBERATELY_ABSENT = {
  test: [],
  production: ['jobs-verification-reminder'],
};

const io = {
  readFile: (file) => readFileSync(file, 'utf8'),
  exists: (file) => existsSync(file),
};

export function auditEnvironment(environment, { root = ROOT } = {}) {
  const mainTfSource = readFileSync(
    join(root, 'infrastructure', 'envs', environment, 'main.tf'),
    'utf8',
  );
  const absent = DELIBERATELY_ABSENT[environment] ?? [];
  return auditGsiGrants({
    handlers: HANDLERS.filter((h) => !absent.includes(h.name)),
    mainTfSource,
    io,
  });
}

function main() {
  let failed = false;

  for (const environment of ENVIRONMENTS) {
    const findings = auditEnvironment(environment);
    const text = describeGsiFindings(findings, { environment, root: ROOT });
    if (findings.length > 0) {
      console.error(text);
      console.error('');
      failed = true;
    } else {
      console.log(text);
    }
  }

  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
