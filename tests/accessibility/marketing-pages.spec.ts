import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const PAGES = [
  '/for-talent',
  '/for-employers',
  '/how-verification-works',
  '/pricing',
  '/trust-safety',
  '/founder',
  '/contact',
  '/privacy',
  '/terms',
  '/cookies',
  '/accessibility',
  '/status',
  '/sign-in',
];

test.describe('Every public marketing page — accessibility', () => {
  for (const path of PAGES) {
    test(`${path} has zero automatically detectable WCAG 2.1/2.2 AA violations`, async ({
      page,
    }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
    });
  }
});
