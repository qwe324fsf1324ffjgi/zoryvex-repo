// Pure logic behind scripts/check-page-titles.mjs.
//
// Every signed-in page shared the root layout's bare "Zoryvex" until
// 2026-09-04, because those pages are client components and Next.js allows
// `metadata` only in a server one. Eighteen pages, one title.
//
// That is not a cosmetic problem. A browser tab is how somebody tells one
// open page from another, browser history is unusable when twenty entries
// read the same, and a screen reader announces the title on every
// navigation - which is what WCAG 2.4.2 "Page Titled" exists to prevent.

const SITE_NAME = 'Zoryvex';

/** The contents of the first <title> in a page, or null. */
export function extractTitle(html) {
  const match = /<title[^>]*>([^<]*)<\/title>/i.exec(html ?? '');
  return match ? match[1].trim() : null;
}

/**
 * Problems worth failing a build over, given every page's title.
 *
 * `pages` is [{ route, title }]. Three rules, each describing a way a
 * person genuinely loses their place:
 *
 *  - no title at all: the browser shows the URL
 *  - the bare site name: every tab reads the same
 *  - a duplicate: two different pages are indistinguishable
 */
export function findTitleProblems(pages) {
  const problems = [];
  const byTitle = new Map();

  for (const { route, title } of pages) {
    if (!title) {
      problems.push(`${route}: no <title> at all.`);
      continue;
    }
    if (title === SITE_NAME) {
      problems.push(
        `${route}: titled just "${SITE_NAME}", so its tab and history entry say nothing about it.`,
      );
      continue;
    }
    const seen = byTitle.get(title);
    if (seen) {
      problems.push(`${route}: shares the title "${title}" with ${seen}.`);
    } else {
      byTitle.set(title, route);
    }
  }

  return problems;
}

/**
 * The skip link is in the root layout, so it is the first thing a keyboard
 * user reaches on every page — but its target lived in the layouts behind
 * the auth guard, so on a protected page it pointed at nothing while the
 * session was checked, and at nothing at all for somebody signed out.
 * Seventeen pages shipped that way.
 *
 * Exactly one, in both directions: none breaks the skip link and leaves the
 * page without a main landmark, and two is a duplicate id, which makes the
 * skip link ambiguous and is invalid HTML besides.
 *
 * Scope worth stating: this reads the build `validate:all` produces, which
 * has no NEXT_PUBLIC_API_BASE_URL and so renders every page in local-fake
 * mode. The deployed build sets that variable and takes different branches.
 * It happens not to matter for landmarks, because every guarded area gets
 * its <main> from a layout rather than from the page, so a page rendering
 * nothing still sits inside one - but this checks one of the two builds,
 * and a future page that moved its landmark out of a layout could differ
 * between them without this noticing.
 */
export function findLandmarkProblems(pages) {
  const problems = [];
  for (const { route, landmarkCount } of pages) {
    if (landmarkCount === 0) {
      problems.push(`${route}: no <main id="main-content">, so the skip link points at nothing.`);
    } else if (landmarkCount > 1) {
      problems.push(
        `${route}: ${landmarkCount} elements with id="main-content"; ids must be unique.`,
      );
    }
  }
  return problems;
}

/** How many skip-link targets a page's HTML contains. */
export function countLandmarks(html) {
  return (html ?? '').match(/id="main-content"/g)?.length ?? 0;
}

/** The og:title a page declares, or null when it declares none. */
export function extractOgTitle(html) {
  const match = /<meta property="og:title" content="([^"]*)"/i.exec(html ?? '');
  return match ? match[1].trim() : null;
}

/**
 * A share card must describe the page it is on.
 *
 * Next.js falls back to a page's own title for openGraph only while the root
 * layout leaves openGraph.title unset - state it there and every page in the
 * product unfurls with the homepage sentence, including a candidate's proof
 * page, which is the one link this product most wants people to send each
 * other. That regression is invisible in the app and visible only in Slack,
 * so it is worth a build-time check rather than a person noticing.
 */
export function findShareCardProblems(pages) {
  const problems = [];
  for (const { route, title, ogTitle } of pages) {
    if (!ogTitle) continue; // a page need not declare one; the root supplies type and site name
    if (ogTitle !== title) {
      problems.push(
        `${route}: share card says "${ogTitle}" but the page is "${title}". ` +
          'The root layout is probably overriding openGraph for every page.',
      );
    }
  }
  return problems;
}
