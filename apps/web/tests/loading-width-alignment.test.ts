import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { glob } from 'node:fs/promises';

/**
 * A skeleton exists to stop the page moving. One at the wrong width moves it
 * more than no skeleton at all.
 *
 * This is not hypothetical. When `PageLoading` was first wired in on
 * 2026-09-05 it was dropped into a bare `<Section>` on every page, which is
 * `max-w-4xl`. Seven of those pages render their real content at `max-w-2xl`
 * or `max-w-md`, so the placeholder was wider than the thing it stood in for
 * and the whole page narrowed the instant the data arrived. The component
 * built to prevent a layout jump was causing one.
 *
 * Nothing else could have caught it. It type-checks, it lints, the axe suite
 * passes, and every end-to-end test still goes green, because the pages are
 * fast enough locally that the skeleton is gone before anything looks at it.
 * It is only visible on a slow connection, which is exactly the situation the
 * component was added for.
 *
 * So the property is asserted from the source: on any page that renders a
 * skeleton, the `Section` around the skeleton and the `Section` around the
 * real `PageHeader` must agree about width. The rule is agreement, not any
 * particular value, so a page is free to change how wide it is as long as it
 * changes both.
 */

const APP_DIR = join(import.meta.dirname, '..', 'app');

function widthOf(sectionAttrs: string): string {
  return /max-w-(\w+)/.exec(sectionAttrs)?.[1] ?? '4xl-default';
}

/** The width of the `<Section …>` that encloses the first hit of `marker`. */
function widthAround(source: string, marker: string): string | null {
  for (const m of source.matchAll(/<Section([^>]*)>/g)) {
    const after = source.slice(m.index + m[0].length);
    const hit = after.indexOf(marker);
    const close = after.indexOf('</Section>');
    if (hit !== -1 && (close === -1 || hit < close)) return widthOf(m[1] ?? '');
  }
  return null;
}

const pages: Array<[string, string]> = [];
for await (const entry of glob('**/*.tsx', { cwd: APP_DIR })) {
  const path = join(APP_DIR, entry);
  const source = readFileSync(path, 'utf8');
  if (source.includes('<PageLoading')) pages.push([entry.replace(/\\/g, '/'), source]);
}

describe('a loading skeleton is the same width as the page it stands in for', () => {
  it('found the pages that render one', () => {
    // Guards the scan itself. If the glob or the marker ever stops matching,
    // every assertion below would pass by testing nothing.
    expect(pages.length).toBeGreaterThan(5);
  });

  it.each(pages)('%s', (_name, source) => {
    const skeleton = widthAround(source, '<PageLoading');
    const content = widthAround(source, '<PageHeader');

    // A page that renders a skeleton but no PageHeader in a Section has
    // nothing to be measured against; that is not a failure.
    if (skeleton === null || content === null) return;

    expect(
      skeleton,
      `the skeleton sits in a ${skeleton} Section and the content in a ${content} one, so the page ` +
        'resizes the moment it loads. Give both Sections the same max-width.',
    ).toBe(content);
  });
});
