import { expect, test } from '@playwright/test';

const PAGES = [
  '/',
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

test.describe('Every public marketing page', () => {
  for (const path of PAGES) {
    test(`${path} loads, has exactly one h1, and no console errors`, async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });
      page.on('pageerror', (err) => consoleErrors.push(err.message));

      const response = await page.goto(path);
      expect(response?.ok(), `${path} did not return an OK response`).toBe(true);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      expect(consoleErrors, `console errors on ${path}: ${JSON.stringify(consoleErrors)}`).toEqual(
        [],
      );
    });
  }

  test('every internal nav/footer link on the home page resolves to a page that loads', async ({
    page,
  }) => {
    await page.goto('/');
    const hrefs = await page
      .locator('a[href^="/"]')
      .evaluateAll((els) => [
        ...new Set(els.map((el) => el.getAttribute('href')).filter((h): h is string => !!h)),
      ]);

    for (const href of hrefs) {
      const response = await page.request.get(href);
      expect(response.ok(), `internal link ${href} did not resolve`).toBe(true);
    }
  });

  test('no page renders unfinished placeholder text', async ({ page }) => {
    for (const path of PAGES) {
      await page.goto(path);
      const body = await page.locator('body').innerText();
      expect(body, `${path} contains placeholder text`).not.toMatch(
        /lorem ipsum|TODO|TBD|placeholder/i,
      );
    }
  });

  test('an unknown URL gets the real Zoryvex 404, not a bare framework default', async ({
    page,
  }) => {
    await page.goto('/this-page-does-not-exist');

    // The site's own chrome, so the page is never a dead end. Asserted via
    // the header/footer landmarks rather than the Primary nav: on mobile that
    // nav is correctly collapsed inside the Menu <details>, so it is legitimately
    // not visible there.
    await expect(page.getByRole('heading', { name: "That page doesn't exist" })).toBeVisible();
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('contentinfo')).toBeVisible();

    // Every escape route actually resolves.
    const hrefs = await page
      .locator('main a[href^="/"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('href')!));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      const response = await page.request.get(href);
      expect(response.ok(), `404-page link ${href} did not resolve`).toBe(true);
    }
  });
});
