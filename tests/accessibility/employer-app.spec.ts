import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readSignInCode } from '../support/outbox';

async function scan(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

/** Signs up a fresh employer and lands on /employer. */
async function signUpFresh(page: Page, label: string) {
  const email = `e2e-a11y-employer-${label}-${Date.now()}@example.com`;
  await page.goto('/employer/sign-in');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send sign-in code' }).click();
  const code = await readSignInCode(page, email);
  await page.getByLabel('Sign-in code').fill(code);
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL(/\/employer$/);
  // Wait for the guarded app shell to actually render, not just the URL to
  // change — confirms the session round-tripped through localStorage before
  // any subsequent hard navigation, which a bare URL match doesn't guarantee.
  await expect(page.getByRole('navigation', { name: 'Employer' })).toBeVisible();
}

async function signIn(page: Page, email: string) {
  await page.goto('/employer/sign-in');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send sign-in code' }).click();
  const code = await readSignInCode(page, email);
  await page.getByLabel('Sign-in code').fill(code);
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL(/\/employer$/);
  await expect(page.getByRole('navigation', { name: 'Employer' })).toBeVisible();
}

test.describe('Employer app — accessibility', () => {
  test('sign-in page (email step)', async ({ page }) => {
    await page.goto('/employer/sign-in');
    await scan(page);
  });

  test('sign-in page (code step)', async ({ page }) => {
    await page.goto('/employer/sign-in');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Email').fill(`e2e-a11y-employer-${Date.now()}@example.com`);
    await page.getByRole('button', { name: 'Send sign-in code' }).click();
    await scan(page);
  });

  test('roles dashboard (empty state)', async ({ page }) => {
    await signUpFresh(page, 'roles-empty');
    await scan(page);
  });

  test('onboarding page', async ({ page }) => {
    await signUpFresh(page, 'onboarding');
    await page.goto('/employer/onboarding');
    await scan(page);
  });

  test('onboarding page with a rate-limit error visible', async ({ page }) => {
    await signUpFresh(page, 'onboarding-429');
    await page.goto('/employer/onboarding');
    await page
      .locator('#invite-emails')
      .fill(
        [
          'a@example.com',
          'b@example.com',
          'c@example.com',
          'd@example.com',
          'e@example.com',
          'f@example.com',
        ].join('\n'),
      );
    await page.getByRole('button', { name: 'Send invites' }).click();
    await scan(page);
  });

  test('new-role wizard: step 1 (track)', async ({ page }) => {
    await signUpFresh(page, 'role-step1');
    await page.goto('/employer/roles/new');
    await scan(page);
  });

  test('new-role wizard: step 2 (details) with validation errors visible', async ({ page }) => {
    await signUpFresh(page, 'role-step2');
    await page.goto('/employer/roles/new');
    await page.getByLabel('Cloud engineering').check();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'See the free preview' }).click();
    await scan(page);
  });

  test('new-role wizard: step 3 (free preview)', async ({ page }) => {
    await signUpFresh(page, 'role-step3');
    await page.goto('/employer/roles/new');
    await page.getByLabel('Cloud engineering').check();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel('Role title').fill('E2E Role');
    await page.getByLabel('Outcomes').fill('Ship something real.');
    await page.getByLabel('Must-have work (one per line)').fill('Has done the thing');
    await page.getByRole('button', { name: 'See the free preview' }).click();
    await scan(page);
  });

  test('role detail page (unpurchased, zero matches)', async ({ page }) => {
    await signUpFresh(page, 'role-detail-empty');
    await page.goto('/employer/roles/new');
    await page.getByLabel('Cloud engineering').check();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel('Role title').fill('E2E Role');
    await page.getByLabel('Outcomes').fill('Ship something real.');
    await page.getByLabel('Must-have work (one per line)').fill('Has done the thing');
    await page.getByRole('button', { name: 'See the free preview' }).click();
    await page.getByRole('link', { name: 'View role & get the Kit' }).click();
    await expect(page).toHaveURL(/\/employer\/role\?id=/);
    await scan(page);
  });

  test('Kit checkout page', async ({ page }) => {
    await signUpFresh(page, 'checkout');
    await page.goto('/employer/roles/new');
    await page.getByLabel('Cloud engineering').check();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel('Role title').fill('E2E Role');
    await page.getByLabel('Outcomes').fill('Ship something real.');
    await page.getByLabel('Must-have work (one per line)').fill('Has done the thing');
    await page.getByRole('button', { name: 'See the free preview' }).click();
    await page.getByRole('link', { name: 'View role & get the Kit' }).click();
    await expect(page).toHaveURL(/\/employer\/role\?id=/);
    await page.getByRole('link', { name: 'Get the Kit' }).click();
    await expect(page).toHaveURL(/\/employer\/role\/checkout\?id=/);
    await scan(page);
  });

  test('role detail page with Kit deliverables', async ({ page }) => {
    await signIn(page, 'hiring.demo@example.com');
    await page.goto('/employer/role?id=role_platform_lead');
    await expect(page.getByText('Purchased. Deliverables below.')).toBeVisible();
    await scan(page);
  });

  test('role detail page with a match list', async ({ page }) => {
    // Scanned the gate-closed partial list until 2026-09-02, when the founder
    // lowered the gate to one match and that state stopped being reachable
    // for a role with matches. Same page, same scan, now in its open state.
    await signIn(page, 'talent.demo@example.com');
    await page.goto('/employer/role?id=role_sre');
    await expect(page.getByText(/must-have requirement/).first()).toBeVisible();
    await scan(page);
  });

  test('billing page (no active subscription)', async ({ page }) => {
    await signIn(page, 'hiring.demo@example.com');
    await page.goto('/employer/billing');
    await scan(page);
  });

  test('billing page cancel-subscription dialog open', async ({ page }) => {
    await signUpFresh(page, 'billing-dialog');
    await page.goto('/employer/billing');
    await page.getByRole('button', { name: 'Subscribe' }).first().click();
    await expect(page.getByText(/Scout · active/i)).toBeVisible();
    await page.getByRole('button', { name: 'Cancel subscription' }).click();
    await scan(page);
  });

  test('role edit page', async ({ page }) => {
    // Added when role editing shipped. Every new page gets an axe scan,
    // because /accessibility says "every interactive control is reachable and
    // operable by keyboard alone" about the whole product rather than about
    // the pages that happened to be built first.
    await signIn(page, 'hiring.demo@example.com');
    await page.goto('/employer/role/edit?id=role_platform_lead');
    await expect(page.getByLabel('Role title')).toBeVisible();
    await scan(page);
  });

  test('role page with matches', async ({ page }) => {
    await signIn(page, 'hiring.demo@example.com');
    await page.goto('/employer/role?id=role_platform_lead');
    await expect(page.getByRole('heading', { name: 'Candidate matches' })).toBeVisible();
    await scan(page);
  });

  test('contact-unlock confirmation dialog open', async ({ page }) => {
    // hiring.demo@example.com already owns role_platform_lead (Kit purchased,
    // gate open) — subscribe it too so the unlock button is actually enabled.
    await signIn(page, 'hiring.demo@example.com');
    await page.goto('/employer/billing');
    await page.getByRole('button', { name: 'Subscribe' }).first().click();
    await expect(page.getByText(/Scout · active/i)).toBeVisible();

    await page.goto('/employer/role?id=role_platform_lead');
    await page.getByRole('button', { name: 'Unlock contact' }).first().click();
    await scan(page);
  });
});
