#!/usr/bin/env node
// Real, checkable performance budget for a MARKETING page's first-load JS,
// measured gzipped (what crosses the network, and what Core Web Vitals
// guidance budgets against). Parses the actual <script src> tags referenced
// by the home page's HTML, rather than summing every chunk in the build —
// the candidate/employer/admin app is expected to be heavier than a
// marketing page and is code-split into its own chunks that a marketing
// visitor never downloads; this only measures what they actually get.
import { readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const outDir = join(root, 'apps/web/out');
const homeHtmlPath = join(outDir, 'index.html');

// 250 KB gzipped is a commonly cited "good" total-JS budget for a
// marketing site's first load.
const BUDGET_BYTES = 250 * 1024;

const html = readFileSync(homeHtmlPath, 'utf8');
const scriptSrcs = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((m) => m[1]);

if (scriptSrcs.length === 0) {
  console.error(
    `No <script src> tags found in ${homeHtmlPath} — the parser or the build output changed.`,
  );
  process.exit(1);
}

let total = 0;
const files = [];
for (const src of scriptSrcs) {
  const filePath = join(outDir, src.replace(/^\//, ''));
  const raw = readFileSync(filePath);
  const gzipSize = gzipSync(raw).length;
  total += gzipSize;
  files.push({ src, rawSize: statSync(filePath).size, gzipSize });
}

console.log(
  `Home page first-load JS: ${(total / 1024).toFixed(1)} KB gzipped across ${files.length} files`,
);

if (total > BUDGET_BYTES) {
  console.error(
    `Bundle budget exceeded: ${(total / 1024).toFixed(1)} KB gzipped > ${(BUDGET_BYTES / 1024).toFixed(1)} KB budget.`,
  );
  for (const f of [...files].sort((a, b) => b.gzipSize - a.gzipSize)) {
    console.error(
      `  - ${f.src}: ${(f.gzipSize / 1024).toFixed(1)} KB gzipped (${(f.rawSize / 1024).toFixed(1)} KB raw)`,
    );
  }
  process.exit(1);
}

console.log(`Within budget (${(BUDGET_BYTES / 1024).toFixed(1)} KB gzipped).`);
