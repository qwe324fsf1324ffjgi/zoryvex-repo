import { expect, test } from '@playwright/test';

test.describe('Home page', () => {
  test('loads with the expected title, headline, and no console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    const response = await page.goto('/');
    expect(response?.ok()).toBe(true);
    await expect(page).toHaveTitle('Zoryvex — Proof-based hiring for cloud roles');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Proof you can check yourself, not a profile you have to believe',
    );
    expect(consoleErrors).toEqual([]);
  });

  test('has one primary CTA per audience', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: /free role diagnostic/i })).toHaveAttribute(
      'href',
      '/for-employers',
    );
    await expect(
      page.getByRole('link', { name: /build your proof profile/i }).first(),
    ).toHaveAttribute('href', '/for-talent');
  });

  test('shows the fictional-data banner and it can be dismissed', async ({ page }) => {
    await page.goto('/');
    const banner = page.getByText(/fictional test data/i);
    await expect(banner).toBeVisible();
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(banner).not.toBeVisible();
  });

  test('skip link is the first focusable element and moves focus to main content', async ({
    page,
    isMobile,
  }) => {
    // Tab-key navigation is a hardware-keyboard scenario; mobile touch
    // emulation (WebKit) doesn't move focus on Tab the way a real desktop
    // keyboard user does, so this path is only meaningful on desktop.
    test.skip(isMobile, 'Keyboard Tab navigation is a desktop input scenario.');

    await page.goto('/');
    await page.keyboard.press('Tab');
    const skipLink = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skipLink).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
  });
});
