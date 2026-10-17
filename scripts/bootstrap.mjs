#!/usr/bin/env node
// Idempotent local setup: safe to re-run any number of times.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const requiredNode = pkg.engines?.node;

if (requiredNode) {
  const current = process.versions.node;
  const [reqMajor] = requiredNode.match(/\d+/) ?? [];
  const [curMajor] = current.split('.');
  if (reqMajor && curMajor !== reqMajor) {
    console.error(
      `Node ${current} does not match the pinned major version (${requiredNode}). Install Node ${reqMajor} (see .nvmrc) before continuing.`,
    );
    process.exit(1);
  }
}

const nodeModulesExists = existsSync(join(root, 'node_modules'));
console.log(
  nodeModulesExists
    ? 'node_modules present — running npm ci to reconcile with the lockfile.'
    : 'Installing dependencies from package-lock.json...',
);
execSync('npm ci', { cwd: root, stdio: 'inherit' });

console.log('Bootstrap complete. Next: npm run lint && npm run typecheck && npm test');
