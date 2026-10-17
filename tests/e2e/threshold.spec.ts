import { expect, test, type Page } from '@playwright/test';
import { readSignInCode } from '../support/outbox';

/**
 * The threshold: what a candidate has to do to be visible at all, and
 * whether the product tells them.
 *
 * `recomputeMatchesForRole` writes no match for a candidate with no verified
 * evidence supporting a requirement — not a match scored zero, no match. So
 * somebody with an account, a filled-in profile and nothing checked is
 * invisible to every employer. That was true from the beginning and nothing
 * on their screen said so, which meant the reasonable conclusion was "this
 * product is empty" rather than "I am outside it".
 *
 * These cover the states a real candidate moves through, in the order they
 * move through them.
 */

async function signInAsDemoCandidate(page: Page, email: string): Promise<void> {
  await page.goto('/candidate/sign-in');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send sign-in code' }).click();

  const code = await readSignInCode(page, email);

  await page.getByLabel('Sign-in code').fill(code);
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL(/\/candidate\//);
}

/** The panel is the first thing on the profile, and announces itself. */
function standing(page: Page) {
  return page.getByRole('status').first();
}

test.describe('The threshold', () => {
  test('a candidate with a live proof is told they are in, and on how many', async ({ page }) => {
    await signInAsDemoCandidate(page, 'amara.demo@example.com');
    await expect(standing(page)).toContainText('You are in, on');
    await expect(standing(page)).toContainText('proof');
  });

  test('a candidate with nothing checked is told they are at the door', async ({ page }) => {
    await signInAsDemoCandidate(page, 'ngozi.demo@example.com');
    await expect(standing(page)).toContainText('You are at the door');
    // The rule, stated where it can be acted on rather than on a marketing
    // page: a claim scores nothing.
    await expect(standing(page)).toContainText('A claim scores nothing');
  });

  /**
   * Asserting the URL alone is not enough, and an earlier version of this
   * test proved it: the panel linked to the check page with no claim named,
   * which is a failure state, and the test passed anyway because the URL was
   * right. The next step has to land somewhere usable.
   */
  test('the door has a handle, not just a sign', async ({ page }) => {
    await signInAsDemoCandidate(page, 'ngozi.demo@example.com');
    await standing(page).getByRole('link', { name: 'Submit a claim to be checked' }).click();

    await expect(page).toHaveURL(/\/candidate\/evidence\/verify\?id=/);
    await expect(page.getByRole('heading', { name: 'Get this claim checked' })).toBeVisible();
    // The claim being checked is echoed back, so nobody checks the wrong one.
    await expect(page.getByText('The claim being checked')).toBeVisible();
  });

  test('the check page says so plainly when a link names no claim', async ({ page }) => {
    await signInAsDemoCandidate(page, 'ngozi.demo@example.com');
    await page.goto('/candidate/evidence/verify');
    // Not "we could not open that claim": nothing was asked for, and saying
    // otherwise sends somebody looking for a problem that is not there.
    await expect(page.getByRole('heading', { name: 'Which claim should we check?' })).toBeVisible();
    await page.getByRole('link', { name: 'Pick a claim' }).click();
    await expect(page).toHaveURL(/\/candidate\/profile$/);
  });

  /**
   * A brand-new candidate is the case that matters most: they have done
   * everything the sign-up asked and are still invisible.
   */
  test('a candidate who has filed nothing is told exactly what to do first', async ({ page }) => {
    await signInAsDemoCandidate(page, `threshold-${Date.now()}@example.com`);
    await page.getByLabel('Cloud engineering').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/candidate\/profile$/);

    await expect(standing(page)).toContainText('Employers cannot see you yet');
    await standing(page).getByRole('link', { name: 'File your first claim' }).click();
    await expect(page).toHaveURL(/\/candidate\/evidence\/new/);
  });

  /**
   * The ritual has to be legible where it is performed, not only described
   * in a brand document. The third line is the hard one and says why.
   */
  test('the claim form names the four lines and what the third one decides', async ({ page }) => {
    await signInAsDemoCandidate(page, `ritual-${Date.now()}@example.com`);
    await page.getByLabel('Cloud engineering').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('link', { name: 'File a claim' }).click();

    await expect(page.getByRole('heading', { name: 'File a claim' })).toBeVisible();
    await expect(page.getByText('Four lines, then a check', { exact: false })).toBeVisible();
    await expect(page.getByText('Not the team.', { exact: false })).toBeVisible();
  });

  /**
   * A proof carries a date. That is the one thing a conventional verified
   * badge refuses to say, and the reason this one is worth trusting.
   */
  test('a proof shows when it was checked, not only that it was', async ({ page }) => {
    await signInAsDemoCandidate(page, 'amara.demo@example.com');
    const proved = page
      .getByRole('listitem')
      .filter({ hasText: 'Migrated a monolith to containerized services' });
    await expect(proved.getByRole('group', { name: /Proved on/ })).toBeVisible();
  });
});
