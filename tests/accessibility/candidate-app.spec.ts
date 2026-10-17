import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readSignInCode } from '../support/outbox';

async function scan(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

/** Signs up a fresh candidate and lands on /candidate/onboarding. */
async function signUpFresh(page: Page, label: string) {
  const email = `e2e-a11y-${label}-${Date.now()}@example.com`;
  await page.goto('/candidate/sign-in');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send sign-in code' }).click();
  const code = await readSignInCode(page, email);
  await page.getByLabel('Sign-in code').fill(code);
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL(/\/candidate\/onboarding$/);
}

async function completeOnboarding(page: Page) {
  await page.getByLabel('Cloud engineering').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/candidate\/profile$/);
}

test.describe('Candidate app — accessibility', () => {
  test('sign-in page (email step)', async ({ page }) => {
    await page.goto('/candidate/sign-in');
    await scan(page);
  });

  test('sign-in page (code step)', async ({ page }) => {
    await page.goto('/candidate/sign-in');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Email').fill(`e2e-a11y-${Date.now()}@example.com`);
    await page.getByRole('button', { name: 'Send sign-in code' }).click();
    await scan(page);
  });

  test('onboarding page', async ({ page }) => {
    await signUpFresh(page, 'onboarding');
    await scan(page);
  });

  test('profile page', async ({ page }) => {
    await signUpFresh(page, 'profile');
    await completeOnboarding(page);
    await scan(page);
  });

  test('add-evidence page', async ({ page }) => {
    await signUpFresh(page, 'evidence');
    await completeOnboarding(page);
    await page.goto('/candidate/evidence/new');
    await scan(page);
  });

  test('account page', async ({ page }) => {
    await signUpFresh(page, 'account');
    await completeOnboarding(page);
    await page.goto('/candidate/account');
    await scan(page);
  });

  test('verify-evidence page, evidence-not-found state', async ({ page }) => {
    await signUpFresh(page, 'verify-missing');
    await completeOnboarding(page);
    await page.goto('/candidate/evidence/verify?id=missing');
    await scan(page);
  });

  /**
   * Both proof routes are scanned in one pass, because each kind of claim
   * gets a different set of controls and scanning only one would leave the
   * other unguarded.
   *
   * The route is no longer chosen on this page. A claim's own kind decides
   * which check it is eligible for, so reaching both forms means filing two
   * claims rather than toggling a radio: a certification, which is confirmed
   * with its issuer, and a repository, which is confirmed on GitHub.
   */
  test('verify-evidence page, both proof routes', async ({ page }) => {
    // The longest test in the suite by some way: a sign-up, onboarding, an
    // eight-field form, a navigation, and TWO axe scans, all on emulated
    // mobile. It outgrew the 30s default and timed out once under parallel
    // load while passing alone and on three consecutive full runs. The work
    // is real rather than slow, so the budget is raised deliberately instead
    // of the assertions being weakened or a retry masking it.
    test.setTimeout(90_000);

    await signUpFresh(page, 'verify-repo');
    await completeOnboarding(page);

    // A fresh account has no evidence, so one is created the way a real
    // candidate would rather than seeded through internals.
    async function fileClaim(sourceType: string, claim: string) {
      await page.getByRole('link', { name: 'File a claim' }).click();
      await expect(page).toHaveURL(/\/candidate\/evidence\/new$/);
      await page.getByLabel('Source type').selectOption({ label: sourceType });
      await page.getByRole('radio', { name: 'Link to it' }).check();
      await page.locator('#source-url').fill('https://example.com/a11y-project');
      await page.getByLabel('Claim').fill(claim);
      await page.getByLabel('Context').fill('Releases were manual');
      await page.getByLabel('Actions').fill('Automated the pipeline end to end');
      await page.getByLabel('Outcome').fill('Releases take 20 minutes');
      await page.getByLabel('Visibility', { exact: true }).selectOption('discovery');
      await page.getByLabel(/I consent/).check();
      await page.getByRole('button', { name: 'File this claim' }).click();
      await expect(page).toHaveURL(/\/candidate\/profile$/);
    }

    async function scanVerifyPageFor(claim: string) {
      const item = page.getByRole('listitem').filter({ hasText: claim });
      await item.getByRole('link', { name: 'Get it checked' }).click();
      await expect(page).toHaveURL(/\/candidate\/evidence\/verify\?id=/);
      await scan(page);
      await page.goBack();
      await expect(page).toHaveURL(/\/candidate\/profile$/);
    }

    await fileClaim('Certification', 'Passed the associate exam');
    await fileClaim('GitHub / code repository', 'Built a deployment pipeline');

    // The badge form and the repository form, each reached by the claim that
    // is actually eligible for it.
    await scanVerifyPageFor('Passed the associate exam');
    await scanVerifyPageFor('Built a deployment pipeline');
  });

  test('profile consents and the employer preview', async ({ page }) => {
    // Both gained content when contact-sharing consent shipped: two grouped
    // checkboxes on the profile, and a preview that now states what an
    // employer can and cannot see.
    await signUpFresh(page, 'consents');
    await completeOnboarding(page);
    await page.getByLabel('Let employers unlock my contact details').check();
    await scan(page);

    await page.goto('/candidate/profile/preview');
    await expect(page.getByText('without your name or email')).toBeVisible();
    await scan(page);
  });
});
