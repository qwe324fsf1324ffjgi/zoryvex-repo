import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { generateKitDeliverables, renderKitHtmlDocument } from '@zoryvex/kit-templates';
import type { Role } from '@zoryvex/contracts';

// The generated Kit is a standalone document served directly by
// services/api (never rendered through apps/web), so these tests load it
// via page.setContent() rather than the app's own baseURL — the same
// deterministic template code the real handler calls
// (services/api/src/domain/kit-service.ts), not a hand-copied fixture.

const baseRole: Role = {
  id: 'role_1',
  employerId: 'emp_1',
  launchTrack: 'aws_cloud',
  title: 'Cloud Engineer',
  seniority: 'mid',
  outcomes: 'Ship infrastructure reliably at scale',
  mustHaveWork: [
    'Wrote Terraform for a real production environment',
    'Ran an on-call incident to resolution',
  ],
  constraints: '',
  status: 'active',
  createdAt: '2026-08-19T00:00:00.000Z',
};

const now = new Date('2026-08-19T00:00:00.000Z');

function renderFor(role: Role): string {
  return renderKitHtmlDocument(role, generateKitDeliverables(role, now));
}

test.describe('Proof Hiring Kit document', () => {
  test('has zero automatically detectable WCAG 2.1/2.2 AA violations', async ({ page }) => {
    await page.setContent(renderFor(baseRole));
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });

  test('keyboard: Tab reaches the skip link first, then the print button, with a visible focus outline', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'Tab-key semantics differ on emulated touch devices — desktop-only check');
    await page.setContent(renderFor(baseRole));
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip-link')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#print-button')).toBeFocused();
    const outline = await page
      .locator('#print-button')
      .evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
  });

  test('keyboard: the print button is activatable with Enter (calls window.print)', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'Tab-key semantics differ on emulated touch devices — desktop-only check');
    await page.setContent(renderFor(baseRole));
    await page.evaluate(() => {
      (window as unknown as { __printed: boolean }).__printed = false;
      window.print = () => {
        (window as unknown as { __printed: boolean }).__printed = true;
      };
    });
    await page.locator('#print-button').focus();
    await page.keyboard.press('Enter');
    const printed = await page.evaluate(
      () => (window as unknown as { __printed: boolean }).__printed,
    );
    expect(printed).toBe(true);
  });

  test('mobile viewport: no horizontal overflow at a narrow width', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.setContent(renderFor(baseRole));
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
  });

  test('print emulation: the print button is hidden and sections avoid page breaks', async ({
    page,
  }) => {
    await page.setContent(renderFor(baseRole));
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('#print-button')).toBeHidden();
    const breakInside = await page
      .locator('section')
      .first()
      .evaluate((el) => getComputedStyle(el).breakInside);
    expect(breakInside).toBe('avoid');
  });

  test('renders correctly with a very long title (word-wraps, no layout break)', async ({
    page,
  }) => {
    const longTitleRole: Role = { ...baseRole, title: 'Senior '.repeat(60) + 'Cloud Engineer' };
    await page.setContent(renderFor(longTitleRole));
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
    await expect(page.locator('h1')).toContainText('Cloud Engineer');
  });

  test('renders correctly with the optional constraints field empty (no stray "Constraints:" label)', async ({
    page,
  }) => {
    await page.setContent(renderFor({ ...baseRole, constraints: '' }));
    await expect(page.getByText('Constraints:')).toHaveCount(0);
  });

  test('renders the optional constraints field when present', async ({ page }) => {
    await page.setContent(
      renderFor({ ...baseRole, constraints: 'Remote-friendly, EU timezone overlap' }),
    );
    await expect(page.getByText('Constraints:')).toBeVisible();
  });

  test('renders correctly with the minimum single mustHaveWork item', async ({ page }) => {
    const role: Role = { ...baseRole, mustHaveWork: ['Solo requirement'] };
    await page.setContent(renderFor(role));
    await expect(page.getByText('Evidence of: Solo requirement')).toBeVisible();
  });
});
