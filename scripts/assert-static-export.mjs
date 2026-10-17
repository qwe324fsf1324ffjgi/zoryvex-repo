#!/usr/bin/env node
// Regression guard: fails CI if a Next app ever stops being a pure static
// export (no server runtime dir, no API routes, no middleware).
// Usage: node scripts/assert-static-export.mjs [app-dir-relative-to-repo-root]
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const appRelDir = process.argv[2] ?? 'apps/web';
const appDir = join(root, appRelDir);
const outDir = join(appDir, 'out');
const failures = [];

if (!existsSync(outDir)) {
  failures.push(`Missing static export output directory: ${outDir}`);
} else {
  if (!existsSync(join(outDir, 'index.html'))) {
    failures.push(`${appRelDir}/out/index.html is missing.`);
  }
  if (existsSync(join(outDir, 'server'))) {
    failures.push(
      `${appRelDir}/out/server exists — static export must not contain a server runtime.`,
    );
  }
}

const routesDir = join(appDir, 'app');
if (existsSync(routesDir)) {
  const hasApiDir = existsSync(join(routesDir, 'api'));
  const hasMiddleware = ['middleware.ts', 'middleware.js'].some((f) => existsSync(join(appDir, f)));
  if (hasApiDir)
    failures.push(`${appRelDir}/app/api exists — API routes are not allowed in the static export.`);
  if (hasMiddleware)
    failures.push(`${appRelDir}/middleware.ts exists — middleware requires a Next server.`);
}

if (failures.length > 0) {
  console.error(`static-export assertion failed for ${appRelDir}:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `static-export assertion passed for ${appRelDir}: pure static output, no server runtime.`,
);
