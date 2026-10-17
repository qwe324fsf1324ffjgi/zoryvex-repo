import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readSignInCode } from '../support/outbox';

async function scan(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/admin/sign-in');
  await page.waitForLoadState('networkidle');
  const email = 'founder.demo@example.com';
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send sign-in code' }).click();
  const code = await readSignInCode(page, email);
  await page.getByLabel('Sign-in code').fill(code);
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('navigation', { name: 'Admin' })).toBeVisible();
}

/**
 * Follows a link in the admin bar at whatever width the test is running at.
 *
 * Below `md` the bar is a collapsed `<details>`, so its links are out of the
 * accessibility tree until the menu is opened, and clicking one directly
 * waits forever. That is correct behaviour for a phone — tap Menu, then the
 * link — so the test opens the menu the way a person would rather than the
 * product exposing links a person cannot see.
 */
async function followNavLink(page: Page, name: string): Promise<void> {
  // Located as an element rather than by role: Chromium exposes <summary> as
  // a disclosure, not a button, so getByRole('button') never matches it.
  const menu = page.locator('header summary');
  if (await menu.isVisible().catch(() => false)) await menu.click();
  await page.getByRole('link', { name }).click();
}

test.describe('Admin app — accessibility', () => {
  test('sign-in page (email step)', async ({ page }) => {
    await page.goto('/admin/sign-in');
    await scan(page);
  });

  test('sign-in page (code step)', async ({ page }) => {
    await page.goto('/admin/sign-in');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Email').fill('founder.demo@example.com');
    await page.getByRole('button', { name: 'Send sign-in code' }).click();
    await scan(page);
  });

  test('dashboard with fixture-backed data', async ({ page }) => {
    await signIn(page);
    await scan(page);
  });

  /**
   * The billing diagnostic in its unconfigured state, which is what this
   * local build can reach: the page reads the real backend only, and there
   * is deliberately no local-fake equivalent. The notice, the heading and
   * the page shell are still real markup and still have to pass.
   */
  test('billing diagnostic', async ({ page }) => {
    await signIn(page);
    await followNavLink(page, 'Billing diagnostic');
    await expect(page.getByRole('heading', { name: 'Billing diagnostic' })).toBeVisible();
    await scan(page);
  });

  test('moderation reason dialog open, with a validation error visible', async ({ page }) => {
    await signIn(page);
    await page
      .getByLabel('Candidate')
      .selectOption({ label: 'Amara (fictional test candidate) (amara.demo@example.com)' });
    await page.getByRole('button', { name: 'Hide from discovery' }).click();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText('A reason is required.')).toBeVisible();
    await scan(page);
  });
});
