#!/usr/bin/env node
// Fails if any exported page has no title, carries only the site name, or
// duplicates another page's title.
//
//   node scripts/check-page-titles.mjs [app-dir-relative-to-repo-root]
//
// Runs against the built static export rather than the source, because the
// title is assembled from a chain of layouts and only the output says what
// a browser will actually show.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  countLandmarks,
  extractOgTitle,
  extractTitle,
  findLandmarkProblems,
  findShareCardProblems,
  findTitleProblems,
} from './lib/page-titles.mjs';

const root = join(import.meta.dirname, '..');
const appRelDir = process.argv[2] ?? 'apps/web';
const outDir = join(root, appRelDir, 'out');

if (!existsSync(outDir)) {
  console.error(`No static export at ${appRelDir}/out. Build the app before running this.`);
  process.exit(1);
}

/** Every .html the export produced, excluding Next's own asset directory. */
function htmlFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === '_next') continue;
      found.push(...htmlFiles(join(dir, entry.name)));
    } else if (entry.name.endsWith('.html')) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

// Next emits the not-found page twice, as /404.html and /_next-style
// /_not-found.html. They are one page, so the second would otherwise read as
// a duplicate title forever.
const pages = htmlFiles(outDir)
  .filter(
    (file) =>
      !relative(outDir, file)
        .split(sep)
        .some((part) => part.startsWith('_')),
  )
  .map((file) => ({
    route: `/${relative(outDir, file)
      .split(sep)
      .join('/')
      .replace(/(index)?\.html$/, '')}`,
    ...(() => {
      const html = readFileSync(file, 'utf8');
      return {
        title: extractTitle(html),
        ogTitle: extractOgTitle(html),
        landmarkCount: countLandmarks(html),
      };
    })(),
  }));

if (pages.length === 0) {
  console.error(`No HTML pages found under ${appRelDir}/out.`);
  process.exit(1);
}

const problems = [
  ...findTitleProblems(pages),
  ...findLandmarkProblems(pages),
  ...findShareCardProblems(pages),
];

if (problems.length) {
  console.error(`Page shell check failed for ${appRelDir}:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    '\nA title is how somebody tells one open tab from another, and what a screen reader',
  );
  console.error('announces on every navigation. Give the page its own, matching its heading.');
  process.exit(1);
}

console.log(
  `Page shell: ${pages.length} pages, ${new Set(pages.map((p) => p.title)).size} distinct titles, ` +
    'none generic, each with one skip-link target and a share card that matches.',
);
