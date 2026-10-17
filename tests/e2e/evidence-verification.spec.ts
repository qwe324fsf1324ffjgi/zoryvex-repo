import { expect, test, type Page } from '@playwright/test';
import { readSignInCode } from '../support/outbox';

/**
 * The fixtures give each demo candidate a different verification state on
 * purpose, so which account you sign in as decides what you can see:
 * amara has a verified item, ngozi has one still awaiting a check.
 */
async function signInAsDemoCandidate(page: Page, email: string): Promise<void> {
  await page.goto('/candidate/sign-in');
  // Without this the fill() can outrun Next's hydration and be silently
  // discarded — the flake this suite already fixed once at every call site.
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send sign-in code' }).click();
  const code = await readSignInCode(page, email);
  await page.getByLabel('Sign-in code').fill(code);
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL(/\/candidate\/profile$/, { timeout: 10_000 });
}

test.describe('Evidence verification', () => {
  test('the profile tells a candidate what an unchecked claim costs them', async ({ page }) => {
    await signInAsDemoCandidate(page, 'amara.demo@example.com');

    // The rule the whole product rests on has to be visible where the
    // candidate can act on it, not buried on a marketing page. It is also
    // the brand's own distinction: a claim is something you say, a proof is
    // something we checked (docs/BRAND.md).
    await expect(page.getByText('Employers only ever see proofs', { exact: false })).toBeVisible();
    await expect(page.getByText('proved so far', { exact: false })).toBeVisible();
  });

  /**
   * The threshold was always real and never stated: a candidate with
   * nothing checked is invisible to every employer, and would reasonably
   * conclude the product was empty rather than that they were outside it.
   */
  test('the profile says where the candidate stands against the threshold', async ({ page }) => {
    await signInAsDemoCandidate(page, 'amara.demo@example.com');
    await expect(page.getByRole('status').filter({ hasText: 'proof' }).first()).toBeVisible();
  });

  test('a proved item shows its mark and offers no route to check it again', async ({ page }) => {
    await signInAsDemoCandidate(page, 'amara.demo@example.com');

    const provedItem = page
      .getByRole('listitem')
      .filter({ hasText: 'Migrated a monolith to containerized services' });
    await expect(provedItem.getByText('Proved', { exact: true })).toBeVisible();
    await expect(provedItem.getByRole('link', { name: 'Get it checked' })).toHaveCount(0);
    await expect(provedItem.getByRole('link', { name: 'Check again' })).toHaveCount(0);
  });

  /**
   * The mark dates itself, which is the one thing a conventional verified
   * badge refuses to do. A credential that lapses is the normal case, not
   * the edge case.
   */
  test('a proof says when it was checked, not just that it was', async ({ page }) => {
    await signInAsDemoCandidate(page, 'amara.demo@example.com');
    const provedItem = page
      .getByRole('listitem')
      .filter({ hasText: 'Migrated a monolith to containerized services' });
    await expect(provedItem.getByRole('group', { name: /Proved on/ })).toBeVisible();
  });

  test('an unverified item offers a route to verify it', async ({ page }) => {
    await signInAsDemoCandidate(page, 'ngozi.demo@example.com');

    const unverified = page
      .getByRole('listitem')
      .filter({ hasText: 'Cut CI pipeline time from 40 to 9 minutes' });
    await expect(unverified.getByText('Not checked yet')).toBeVisible();
    await unverified.getByRole('link', { name: 'Get it checked' }).click();

    await expect(page).toHaveURL(/\/candidate\/evidence\/verify\?id=/);
    await expect(page.getByRole('heading', { name: 'Get this claim checked' })).toBeVisible();
    // The claim being checked is echoed back, so nobody verifies the wrong item.
    await expect(page.getByText('Cut CI pipeline time from 40 to 9 minutes')).toBeVisible();
  });

  /**
   * The route is no longer chosen here, and these two tests record the
   * change rather than being deleted with the control they used to drive.
   *
   * They used to check that three radio options were offered and that
   * switching between them swapped the form. A claim's own kind now decides
   * which check it is eligible for: filed as a certification, it is
   * confirmed with the issuer; filed as code, by proving the account and
   * reading the repository. Asking a question whose only acceptable answer
   * was already known was just a way of letting people get it wrong, and it
   * let a claim be filed as one thing and verified as another.
   *
   * The third option, a practical task, is gone entirely - see ADR 0005.
   */
  async function fileClaim(
    page: import('@playwright/test').Page,
    sourceType: string,
    claim: string,
  ) {
    await page.getByRole('link', { name: 'File a claim' }).click();
    await page.getByLabel('Source type').selectOption({ label: sourceType });
    await page.getByRole('radio', { name: 'Link to it' }).check();
    await page.locator('#source-url').fill('https://example.com/thing');
    await page.getByLabel('Claim').fill(claim);
    await page.getByLabel('Context').fill('Some context');
    await page.getByLabel('Actions').fill('What I did');
    await page.getByLabel('Outcome').fill('What happened');
    await page.getByLabel('Visibility', { exact: true }).selectOption('discovery');
    await page.getByLabel(/I consent/).check();
    await page.getByRole('button', { name: 'File this claim' }).click();
    await expect(page).toHaveURL(/\/candidate\/profile$/);
  }

  test('a certification claim gets the issuer check, and only that', async ({ page }) => {
    // Files a claim through the real form before it can check anything, so
    // it carries a sign-in, an eight-field submit and two navigations. That
    // is close to the 90s budget this machine's low free memory already
    // selects, and it exceeded it once under a full parallel run while
    // passing three times out of three alone. The work is real rather than
    // slow, so the budget is raised deliberately instead of the assertions
    // being weakened or a retry hiding it - the same call the accessibility
    // suite already made for the same reason.
    test.setTimeout(150_000);
    await signInAsDemoCandidate(page, 'ngozi.demo@example.com');
    await fileClaim(page, 'Certification', 'Passed the associate exam');

    const item = page.getByRole('listitem').filter({ hasText: 'Passed the associate exam' });
    await item.getByRole('link', { name: 'Get it checked' }).click();

    await expect(page.getByLabel('Public badge link')).toBeVisible();
    await expect(page.getByLabel('Link to the repository')).toHaveCount(0);
    // Nothing to choose: the page applies the one check this claim can have.
    await expect(page.getByRole('radio', { name: 'Code you published' })).toHaveCount(0);
  });

  test('a repository claim gets the GitHub check, and only that', async ({ page }) => {
    // Files a claim through the real form before it can check anything, so
    // it carries a sign-in, an eight-field submit and two navigations. That
    // is close to the 90s budget this machine's low free memory already
    // selects, and it exceeded it once under a full parallel run while
    // passing three times out of three alone. The work is real rather than
    // slow, so the budget is raised deliberately instead of the assertions
    // being weakened or a retry hiding it - the same call the accessibility
    // suite already made for the same reason.
    test.setTimeout(150_000);
    await signInAsDemoCandidate(page, 'ngozi.demo@example.com');
    await fileClaim(page, 'GitHub / code repository', 'Built a deployment pipeline');

    const item = page.getByRole('listitem').filter({ hasText: 'Built a deployment pipeline' });
    await item.getByRole('link', { name: 'Get it checked' }).click();

    await expect(page.getByLabel('Link to the repository')).toBeVisible();
    await expect(page.getByLabel('Link to the gist with your code')).toBeVisible();
    await expect(page.getByLabel('Public badge link')).toHaveCount(0);
  });

  test('a write-up says there is nothing to check it against, and what to do instead', async ({
    page,
  }) => {
    // The honest third case. There is no source outside the candidate for a
    // project write-up, so the page says so and points at the one thing that
    // does work, rather than offering a check that would fail.
    // Files a claim through the real form before it can check anything, so
    // it carries a sign-in, an eight-field submit and two navigations. That
    // is close to the 90s budget this machine's low free memory already
    // selects, and it exceeded it once under a full parallel run while
    // passing three times out of three alone. The work is real rather than
    // slow, so the budget is raised deliberately instead of the assertions
    // being weakened or a retry hiding it - the same call the accessibility
    // suite already made for the same reason.
    test.setTimeout(150_000);
    await signInAsDemoCandidate(page, 'ngozi.demo@example.com');
    await fileClaim(page, 'Project write-up', 'Rebuilt the release process');

    const item = page.getByRole('listitem').filter({ hasText: 'Rebuilt the release process' });
    await item.getByRole('link', { name: 'Get it checked' }).click();

    await expect(
      page.getByRole('heading', { name: /nothing outside you to check this against/i }),
    ).toBeVisible();
    // Asking a colleague was removed on 2026-09-09, so the page must offer
    // no route at all here rather than a dead one.
    await expect(page.getByRole('heading', { name: 'Ask someone to confirm this' })).toHaveCount(0);
  });

  test('the practical task is no longer offered as a route', async ({ page }) => {
    // Retired on 2026-09-06: the rubric was solvable from the published
    // brief by a language model, so the mark said nothing about the person.
    // Files a claim through the real form before it can check anything, so
    // it carries a sign-in, an eight-field submit and two navigations. That
    // is close to the 90s budget this machine's low free memory already
    // selects, and it exceeded it once under a full parallel run while
    // passing three times out of three alone. The work is real rather than
    // slow, so the budget is raised deliberately instead of the assertions
    // being weakened or a retry hiding it - the same call the accessibility
    // suite already made for the same reason.
    test.setTimeout(150_000);
    await signInAsDemoCandidate(page, 'ngozi.demo@example.com');
    await fileClaim(page, 'Certification', 'Passed another exam');

    const item = page.getByRole('listitem').filter({ hasText: 'Passed another exam' });
    await item.getByRole('link', { name: 'Get it checked' }).click();

    await expect(page.getByLabel('A short practical task')).toHaveCount(0);
    await expect(page.getByText('counts with every employer', { exact: false })).toHaveCount(0);
  });

  test('the demo build says the check cannot run here rather than faking a pass', async ({
    page,
  }) => {
    // Verification calls Credly and GitHub directly, so the local demo
    // genuinely cannot run it. Showing a fake pass would invent an outcome,
    // which is exactly what a proof-first product must never do.
    await signInAsDemoCandidate(page, 'ngozi.demo@example.com');
    const unverified = page
      .getByRole('listitem')
      .filter({ hasText: 'Cut CI pipeline time from 40 to 9 minutes' });
    await unverified.getByRole('link', { name: 'Get it checked' }).click();

    await expect(page.getByText('Not available in this demo build')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run the check' })).toHaveCount(0);
  });

  test('an unknown evidence id fails as not-found rather than a blank page', async ({ page }) => {
    await signInAsDemoCandidate(page, 'amara.demo@example.com');
    await page.goto('/candidate/evidence/verify?id=does-not-exist');

    await expect(page.getByText('We could not open that claim')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to your profile' })).toBeVisible();
  });
});
