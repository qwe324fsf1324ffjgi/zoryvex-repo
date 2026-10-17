import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('Home shell — accessibility', () => {
  test('has zero automatically detectable WCAG 2.1/2.2 AA violations', async ({ page }) => {
    await page.goto('/');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
});
