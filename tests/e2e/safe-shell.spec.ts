import { expect, test } from '@playwright/test';

const SAFE_SHELL_URL = 'http://localhost:4174';

test.describe('Safe-shell neutral status build', () => {
  test('shows only the neutral status text, no console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    const response = await page.goto(SAFE_SHELL_URL);
    expect(response?.ok()).toBe(true);
    await expect(page.getByRole('heading')).toHaveText(
      'Technical deployment complete — public access is not open',
    );
    expect(consoleErrors).toEqual([]);
  });

  test('makes zero cross-origin network requests', async ({ page }) => {
    const requestUrls: string[] = [];
    page.on('request', (req) => requestUrls.push(req.url()));

    await page.goto(SAFE_SHELL_URL);
    await page.waitForLoadState('networkidle');

    const crossOrigin = requestUrls.filter((url) => !url.startsWith(SAFE_SHELL_URL));
    expect(crossOrigin, `Unexpected cross-origin requests: ${JSON.stringify(crossOrigin)}`).toEqual(
      [],
    );
  });

  test('has no form, input, or outbound link on the page', async ({ page }) => {
    await page.goto(SAFE_SHELL_URL);
    expect(await page.locator('form').count()).toBe(0);
    expect(await page.locator('input').count()).toBe(0);
    expect(await page.locator('button').count()).toBe(0);
    expect(await page.locator('a').count()).toBe(0);
  });

  test('page source contains no Paystack, Cognito, or contact-link reference', async ({ page }) => {
    await page.goto(SAFE_SHELL_URL);
    const html = await page.content();
    expect(html).not.toMatch(/paystack/i);
    expect(html).not.toMatch(/cognito/i);
    expect(html).not.toMatch(/wa\.link/i);
    expect(html).not.toMatch(/linkedin\.com/i);
  });
});
