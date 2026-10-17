import { expect, test, type Page } from '@playwright/test';
import { readSignInCode } from '../support/outbox';

function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

async function signUpCandidate(page: Page, label: string): Promise<void> {
  await page.goto('/candidate/sign-in');
  await page.waitForLoadState('networkidle');
  const email = `e2e-console-candidate-${label}-${Date.now()}@example.com`;
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send sign-in code' }).click();
  const code = await readSignInCode(page, email);
  await page.getByLabel('Sign-in code').fill(code);
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL(/\/candidate\/onboarding$/);
}

async function signUpEmployer(page: Page, label: string): Promise<void> {
  await page.goto('/employer/sign-in');
  await page.waitForLoadState('networkidle');
  const email = `e2e-console-employer-${label}-${Date.now()}@example.com`;
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send sign-in code' }).click();
  const code = await readSignInCode(page, email);
  await page.getByLabel('Sign-in code').fill(code);
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL(/\/employer$/);
}

async function signInAdmin(page: Page): Promise<void> {
  await page.goto('/admin/sign-in');
  await page.waitForLoadState('networkidle');
  const email = 'founder.demo@example.com';
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send sign-in code' }).click();
  const code = await readSignInCode(page, email);
  await page.getByLabel('Sign-in code').fill(code);
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

test.describe('No console/hydration errors on key authenticated pages', () => {
  test('candidate: onboarding, profile, account', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await signUpCandidate(page, 'errcheck');
    await page.getByLabel('Cloud engineering').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/candidate\/profile$/);
    await page.goto('/candidate/account');
    await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('employer: roles dashboard, new-role wizard, billing', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await signUpEmployer(page, 'errcheck');
    await expect(page.getByText('No roles yet')).toBeVisible();
    await page.goto('/employer/roles/new');
    await expect(page.getByRole('heading', { name: 'New role' })).toBeVisible();
    await page.goto('/employer/billing');
    await expect(page.getByRole('heading', { name: 'Billing' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('admin: dashboard with fixture-backed data', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await signInAdmin(page);
    await expect(page.getByRole('heading', { name: 'Founder/admin console' })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
