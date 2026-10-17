#!/usr/bin/env node
// Fails when .zoryvex/state.json stops matching .zoryvex/state.schema.json.
//
// CLAUDE.md makes state.json authoritative for phase, counters, checks and the
// next safe action, and says to treat it as ground truth over CLAUDE.md's own
// memory of prior sessions. Until now nothing checked it against the schema
// filed beside it, so a hand-edited counter, a dropped required property or a
// status string that is not one of the four allowed values would have been
// read straight back as fact on the next resume.
//
// Static and offline, like the other checks in the validate job — it reads two
// files and exits.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateDocument } from './lib/state-schema.mjs';

const ROOT = join(import.meta.dirname, '..');
const STATE_FILE = join('.zoryvex', 'state.json');
const SCHEMA_FILE = join('.zoryvex', 'state.schema.json');

/** Parses a JSON file, reporting the path rather than a bare SyntaxError. */
function readJson(file, { root = ROOT } = {}) {
  const text = readFileSync(join(root, file), 'utf8');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error.message}`);
  }
}

export function checkStateSchema({ root = ROOT } = {}) {
  return validateDocument(readJson(STATE_FILE, { root }), readJson(SCHEMA_FILE, { root }));
}

function main() {
  let problems;
  try {
    problems = checkStateSchema();
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }

  if (problems.length > 0) {
    console.error(`✗ ${STATE_FILE} does not match ${SCHEMA_FILE}:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  console.log(`${STATE_FILE} matches ${SCHEMA_FILE}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
