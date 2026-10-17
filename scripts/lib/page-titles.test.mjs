import { describe, expect, it } from 'vitest';
import {
  countLandmarks,
  extractOgTitle,
  extractTitle,
  findLandmarkProblems,
  findShareCardProblems,
  findTitleProblems,
} from './page-titles.mjs';

describe('extractTitle', () => {
  it('reads the title out of a page', () => {
    expect(extractTitle('<head><title>Pricing — Zoryvex</title></head>')).toBe('Pricing — Zoryvex');
  });

  it('trims surrounding whitespace', () => {
    expect(extractTitle('<title>  Account — Zoryvex  </title>')).toBe('Account — Zoryvex');
  });

  it('returns null when there is no title', () => {
    expect(extractTitle('<head><meta charset="utf-8"></head>')).toBeNull();
    expect(extractTitle('')).toBeNull();
    expect(extractTitle(undefined)).toBeNull();
  });

  it('takes the first title when a page somehow has two', () => {
    expect(extractTitle('<title>First</title><title>Second</title>')).toBe('First');
  });
});

describe('findTitleProblems', () => {
  it('passes a set of distinct, specific titles', () => {
    expect(
      findTitleProblems([
        { route: '/', title: 'Zoryvex — Proof-based hiring for cloud roles' },
        { route: '/pricing', title: 'Pricing — Zoryvex' },
      ]),
    ).toEqual([]);
  });

  /**
   * The exact state eighteen signed-in pages were in: every one inherited
   * the root layout's bare site name, so tabs were indistinguishable,
   * history was unusable, and a screen reader announced the same title on
   * every navigation.
   */
  it('rejects a page titled only with the site name', () => {
    const [problem] = findTitleProblems([{ route: '/candidate/profile', title: 'Zoryvex' }]);
    expect(problem).toContain('/candidate/profile');
    expect(problem).toContain('say nothing about it');
  });

  it('rejects a page with no title at all', () => {
    const [problem] = findTitleProblems([{ route: '/somewhere', title: null }]);
    expect(problem).toContain('no <title>');
  });

  it('rejects two pages sharing a title, and names both', () => {
    const [problem] = findTitleProblems([
      { route: '/a', title: 'Billing — Zoryvex' },
      { route: '/b', title: 'Billing — Zoryvex' },
    ]);
    expect(problem).toContain('/b');
    expect(problem).toContain('/a');
  });

  it('reports each problem once rather than compounding on a repeated title', () => {
    // Three pages sharing a title is two problems, not three: the first
    // occurrence is the one the others collide with.
    const problems = findTitleProblems([
      { route: '/a', title: 'Same' },
      { route: '/b', title: 'Same' },
      { route: '/c', title: 'Same' },
    ]);
    expect(problems).toHaveLength(2);
  });

  it('accepts a title that merely contains the site name', () => {
    // "Zoryvex — Proof-based hiring for cloud roles" is the homepage and is
    // fine. Only the bare name is the problem.
    expect(
      findTitleProblems([{ route: '/', title: 'Zoryvex — Proof-based hiring for cloud roles' }]),
    ).toEqual([]);
  });

  it('passes an empty set rather than throwing', () => {
    expect(findTitleProblems([])).toEqual([]);
  });
});

describe('countLandmarks', () => {
  it('counts the skip-link targets on a page', () => {
    expect(countLandmarks('<main id="main-content" tabindex="-1">x</main>')).toBe(1);
    expect(countLandmarks('<div id="main-content"></div><div id="main-content"></div>')).toBe(2);
  });

  it('returns zero for a page without one, and for no html at all', () => {
    expect(countLandmarks('<div>content</div>')).toBe(0);
    expect(countLandmarks(undefined)).toBe(0);
  });
});

describe('findLandmarkProblems', () => {
  it('passes a page with exactly one target', () => {
    expect(findLandmarkProblems([{ route: '/', landmarkCount: 1 }])).toEqual([]);
  });

  /**
   * The state seventeen signed-in pages shipped in: the skip link sits in
   * the root layout and its target lived behind the auth guard, so it
   * pointed at nothing while the session was checked and at nothing at all
   * for somebody signed out.
   */
  it('rejects a page with no target', () => {
    const [problem] = findLandmarkProblems([{ route: '/candidate/profile', landmarkCount: 0 }]);
    expect(problem).toContain('/candidate/profile');
    expect(problem).toContain('points at nothing');
  });

  it('rejects a duplicated id, which is invalid and makes the skip link ambiguous', () => {
    const [problem] = findLandmarkProblems([{ route: '/x', landmarkCount: 2 }]);
    expect(problem).toContain('must be unique');
  });

  it('reports every page rather than stopping at the first', () => {
    expect(
      findLandmarkProblems([
        { route: '/a', landmarkCount: 0 },
        { route: '/b', landmarkCount: 1 },
        { route: '/c', landmarkCount: 3 },
      ]),
    ).toHaveLength(2);
  });
});

describe('extractOgTitle', () => {
  it('reads the share card title', () => {
    expect(extractOgTitle('<meta property="og:title" content="Pricing — Zoryvex"/>')).toBe(
      'Pricing — Zoryvex',
    );
  });

  it('returns null when the page declares none', () => {
    expect(extractOgTitle('<meta name="description" content="x"/>')).toBeNull();
    expect(extractOgTitle(undefined)).toBeNull();
  });
});

describe('findShareCardProblems', () => {
  it('passes when the card describes the page it is on', () => {
    expect(
      findShareCardProblems([
        { route: '/pricing', title: 'Pricing — Zoryvex', ogTitle: 'Pricing — Zoryvex' },
      ]),
    ).toEqual([]);
  });

  /**
   * The regression this exists for, which is invisible in the app and shows
   * up only in Slack or LinkedIn. Next.js falls back to a page's own title
   * for openGraph only while the root layout leaves openGraph.title unset;
   * setting it there makes every page unfurl with the homepage sentence,
   * including the candidate proof page this product most wants shared.
   */
  it('catches every page unfurling as the homepage', () => {
    const problems = findShareCardProblems([
      { route: '/pricing', title: 'Pricing — Zoryvex', ogTitle: 'Zoryvex' },
      { route: '/proof', title: 'Verified proof — Zoryvex', ogTitle: 'Zoryvex' },
    ]);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('root layout is probably overriding');
  });

  it('ignores a page that declares no card of its own', () => {
    // The root supplies type and site name; a page need not restate a title.
    expect(findShareCardProblems([{ route: '/x', title: 'X — Zoryvex', ogTitle: null }])).toEqual(
      [],
    );
  });
});
