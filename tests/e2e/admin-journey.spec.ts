import { KIT_PRICE_NGN } from '@zoryvex/contracts';
import { ENTITLEMENTS } from '@zoryvex/local-adapters';
import { expect, test, type Page } from '@playwright/test';
import { readSignInCode } from '../support/outbox';

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/admin/sign-in');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send sign-in code' }).click();
  const code = await readSignInCode(page, email);
  await page.getByLabel('Sign-in code').fill(code);
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  // Sign-in is a synchronous local-adapters call + router.replace, no
  // network round trip — the default 5s budget is normally generous, but
  // was observed too tight once under CI's shared-runner contention when
  // the mobile and desktop projects run in parallel (PR #57 CI run).
  await expect(page).toHaveURL(/\/admin$/, { timeout: 10_000 });
  await expect(page.getByRole('navigation', { name: 'Admin' })).toBeVisible();
}

test.describe('Founder/admin journey', () => {
  test('signs in and sees fixture-backed read-only platform views', async ({ page }) => {
    await signIn(page, 'founder.demo@example.com');

    await expect(page.getByText('Founder/admin console')).toBeVisible();

    // Health counts — derived from the seed fixtures, not fabricated. Candidates
    // (12) and matches (9 = 5 + 4 + 0) are unique numbers on this page; employers
    // and roles both happen to be 3, so those are checked via the subscriptions
    // list below instead of an ambiguous bare "3" text match.
    await expect(page.getByText('12', { exact: true })).toBeVisible();
    await expect(page.getByText('9', { exact: true })).toBeVisible();

    // Revenue — one succeeded Kit checkout at the current Kit price, plus
    // Atlas's active Scout plan.
    //
    // Atlas's figure comes from the fixture, NOT from SUBSCRIPTION_PRICES_NGN,
    // and that is the whole point of the fixture: it holds a founding price
    // for the life of its subscription, so after the 2026-09-02 raise it is
    // deliberately a price the current rules would no longer sell. Asserting
    // the current founding price here would have quietly deleted the only
    // test of a grandfathered member.
    //
    // Read from the fixture rather than typed out, so the two cannot drift.
    const atlas = ENTITLEMENTS.find((e) => e.employerId === 'emp_atlas');
    await expect(page.getByText(`NGN ${KIT_PRICE_NGN.toLocaleString('en-NG')}`)).toBeVisible();
    await expect(page.getByText(`NGN ${atlas!.priceNGN.toLocaleString('en-NG')}`)).toBeVisible();

    // Subscriptions list — all three fixture employers, by organization name.
    await expect(page.getByText('Northwind Cloud Ltd (fictional test employer)')).toBeVisible();
    await expect(page.getByText('Delta Systems (fictional test employer)')).toBeVisible();
    await expect(page.getByText('Atlas Security Partners (fictional test employer)')).toBeVisible();
    await expect(page.getByText('scout · active')).toBeVisible();
  });

  test('an unauthenticated visitor is redirected away from /admin', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/sign-in$/);
  });

  test('a non-employer, non-candidate session cannot reach /admin', async ({ page }) => {
    // Sign in as an existing employer, then try the admin route directly.
    await page.goto('/employer/sign-in');
    await page.waitForLoadState('networkidle');
    const employerEmail = 'hiring.demo@example.com';
    await page.getByLabel('Email').fill(employerEmail);
    await page.getByRole('button', { name: 'Send sign-in code' }).click();
    const code = await readSignInCode(page, employerEmail);
    await page.getByLabel('Sign-in code').fill(code);
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page).toHaveURL(/\/employer$/);

    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/sign-in$/);
  });

  test('an unrecognized email on the admin sign-in is rejected, never self-serve-created', async ({
    page,
  }) => {
    await page.goto('/admin/sign-in');
    await page.waitForLoadState('networkidle');
    const strangerEmail = `not-the-founder-${Date.now()}@example.com`;
    await page.getByLabel('Email').fill(strangerEmail);
    await page.getByRole('button', { name: 'Send sign-in code' }).click(); // a code is still sent (enumeration-resistant)
    // Read the code sent to THIS address. Reading the newest message in the
    // outbox would hand this test a valid code belonging to a real account,
    // which is the one thing that would make it pass for the wrong reason.
    const code = await readSignInCode(page, strangerEmail);
    await page.getByLabel('Sign-in code').fill(code);
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page.locator('#code-error')).toHaveText(/incorrect or has expired/i);
  });

  test('moderation: hiding a profile from discovery requires a reason and is logged to the audit trail', async ({
    page,
  }) => {
    await signIn(page, 'founder.demo@example.com');

    await page
      .getByLabel('Candidate')
      .selectOption({ label: 'Amara (fictional test candidate) (amara.demo@example.com)' });
    await expect(page.getByText('Currently visible to employers.')).toBeVisible();

    await page.getByRole('button', { name: 'Hide from discovery' }).click();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText('A reason is required.')).toBeVisible();

    await page.getByLabel('Reason').fill('Candidate requested removal from marketplace search.');
    await page.getByRole('button', { name: 'Confirm' }).click();

    await expect(page.getByText('Currently hidden.')).toBeVisible();
    await expect(page.getByText(/hide_from_discovery · candidate/)).toBeVisible();
    await expect(
      page.getByText('Reason: Candidate requested removal from marketplace search.'),
    ).toBeVisible();
  });

  test('moderation: removing an evidence item is logged to the audit trail', async ({ page }) => {
    await signIn(page, 'founder.demo@example.com');

    await page
      .getByLabel('Candidate')
      .selectOption({ label: 'Amara (fictional test candidate) (amara.demo@example.com)' });
    const removeButtons = page.getByRole('button', { name: 'Remove' });
    const evidenceCountBefore = await removeButtons.count();
    expect(evidenceCountBefore).toBeGreaterThan(0);

    await removeButtons.first().click();
    await page.getByLabel('Reason').fill('Evidence link no longer resolves.');
    await page.getByRole('button', { name: 'Confirm' }).click();

    await expect(removeButtons).toHaveCount(evidenceCountBefore - 1);
    await expect(page.getByText(/remove_evidence · evidence/)).toBeVisible();
  });
});
