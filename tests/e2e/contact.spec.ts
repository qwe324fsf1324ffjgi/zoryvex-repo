import { expect, test } from '@playwright/test';

test.describe('Contact page', () => {
  test('exposes exactly the WhatsApp and LinkedIn links, correctly attributed', async ({
    page,
  }) => {
    await page.goto('/contact');

    const whatsapp = page.getByRole('link', { name: /open whatsapp/i });
    await expect(whatsapp).toHaveAttribute('href', 'https://wa.link/pfgnlv');
    await expect(whatsapp).toHaveAttribute('target', '_blank');
    await expect(whatsapp).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(whatsapp).toHaveText(/leaves zoryvex/i);

    const linkedin = page.getByRole('link', { name: /open linkedin/i });
    await expect(linkedin).toHaveAttribute(
      'href',
      'https://www.linkedin.com/in/zerah-abba-a96233269',
    );
    await expect(linkedin).toHaveAttribute('target', '_blank');
    await expect(linkedin).toHaveAttribute('rel', 'noopener noreferrer');
  });

  test('never renders a personal email address', async ({ page }) => {
    await page.goto('/contact');
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/gmail\.com/i);
    expect(body).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
  });

  test('external links carry no tracking query parameters', async ({ page }) => {
    await page.goto('/contact');
    const hrefs = await page
      .locator('a[target="_blank"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('href')));
    for (const href of hrefs) {
      expect(href).not.toMatch(/[?&](utm_|ref=|fbclid|gclid)/i);
    }
  });
});
