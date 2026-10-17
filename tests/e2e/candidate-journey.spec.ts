import { expect, test } from '@playwright/test';
import { readSignInCode } from '../support/outbox';

test.describe('Candidate journey: sign-up through evidence and account', () => {
  test('sign up, onboard, edit profile with autosave, add evidence, preview, export, delete', async ({
    page,
  }) => {
    const email = `e2e-candidate-${Date.now()}@example.com`;

    // --- Sign up ---
    await page.goto('/candidate/sign-in');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send sign-in code' }).click();

    // Same 15s as the employer helper, for the same reason: the first
    // assertion after a state transition on a freshly served page, which has
    // exceeded the 5s default under a full parallel run while passing every
    // isolated one.
    await expect(page.getByText(email)).toBeVisible({ timeout: 15_000 });
    const code = await readSignInCode(page, email);
    await page.getByLabel('Sign-in code').fill(code);
    await page.getByRole('button', { name: 'Verify and sign in' }).click();

    // --- Onboarding (new account, not yet onboarded) ---
    await expect(page).toHaveURL(/\/candidate\/onboarding$/);
    await page.getByLabel('DevOps/platform').check();
    await page.getByRole('button', { name: 'Continue' }).click();

    // --- Profile: autosave ---
    await expect(page).toHaveURL(/\/candidate\/profile$/);
    await page.getByLabel('Display name').fill('E2E Test Candidate');
    await expect(page.getByText('Saving…')).toBeVisible();
    await expect(page.getByText('All changes saved.')).toBeVisible({ timeout: 5000 });
    await page.reload();
    await expect(page.getByLabel('Display name')).toHaveValue('E2E Test Candidate');

    // --- File a claim (visible to discovery, so it shows in the preview) ---
    await page.getByRole('link', { name: 'File a claim' }).click();
    await expect(page).toHaveURL(/\/candidate\/evidence\/new$/);
    await page.getByRole('radio', { name: 'Link to it' }).check();
    await page.locator('#source-url').fill('https://example.com/e2e-project');
    await page.getByLabel('Claim').fill('Automated an entire release pipeline');
    await page.getByLabel('Context').fill('Manual releases took a full day each');
    await page.getByLabel('Actions').fill('Wrote CI/CD automation end to end');
    await page.getByLabel('Outcome').fill('Releases now take 20 minutes');
    await page.getByLabel('Visibility', { exact: true }).selectOption('discovery');
    await page.getByLabel(/I consent/).check();
    await page.getByRole('button', { name: 'File this claim' }).click();

    await expect(page).toHaveURL(/\/candidate\/profile$/);
    await expect(page.getByText('Automated an entire release pipeline')).toBeVisible();

    // --- Preview: opted out of discovery by default, so a warning shows ---
    await page.getByRole('link', { name: 'Preview as an employer would see it' }).click();
    await expect(page.getByText(/not opted into employer discovery/i)).toBeVisible();

    // --- Opt into discovery, evidence should now appear in preview ---
    await page.goBack();
    await page.getByLabel('Opt into employer discovery').check();
    await page.getByRole('link', { name: 'Preview as an employer would see it' }).click();
    await expect(page.getByText(/not currently opted into discovery/i)).not.toBeVisible();
    await expect(page.getByText('Automated an entire release pipeline')).toBeVisible();

    // --- Evidence delete: requires confirmation, Cancel leaves it intact ---
    await page.goto('/candidate/profile');
    const evidenceCard = page.getByText('Automated an entire release pipeline', { exact: true });
    await page.getByRole('button', { name: 'Delete' }).click();
    const confirmDialog = page.getByRole('heading', { name: 'Delete this evidence item?' });
    await expect(confirmDialog).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirmDialog).not.toBeVisible();
    await expect(evidenceCard).toBeVisible();

    // --- Evidence delete: confirming actually removes it ---
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Yes, delete' }).click();
    await expect(evidenceCard).not.toBeVisible();
    await expect(page.getByText('Nothing filed yet')).toBeVisible();

    // --- Account: export ---
    await page.goto('/candidate/account');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download my data' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('zoryvex-my-data.json');

    // --- Account: delete (last step — destroys the session) ---
    await page.getByRole('button', { name: 'Delete my account' }).click();
    await page.getByRole('button', { name: 'Yes, delete everything' }).click();
    await expect(page).toHaveURL(/\/$/);

    // Signed out — protected routes redirect back to sign-in.
    await page.goto('/candidate/profile');
    await expect(page).toHaveURL(/\/candidate\/sign-in$/);
  });

  test('a candidate can turn contact sharing on, and see what it changes', async ({ page }) => {
    // The server refuses every contact unlock unless the candidate has set
    // this, and until now no page could set it — so on the real backend no
    // employer could ever have reached anybody.
    const email = `e2e-consent-${Date.now()}@example.com`;
    await page.goto('/candidate/sign-in');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send sign-in code' }).click();
    await page.getByLabel('Sign-in code').fill(await readSignInCode(page, email));
    await page.getByRole('button', { name: 'Verify and sign in' }).click();

    // Wait for the app's own redirect rather than racing it with a goto. On a
    // slower emulated device the explicit navigation lost that race and the
    // frame load was interrupted.
    await expect(page).toHaveURL(/\/candidate\/onboarding$/);
    await page.getByRole('radio', { name: 'Cloud engineering' }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/candidate\/profile$/);

    const contactSharing = page.getByLabel('Let employers unlock my contact details');
    await expect(contactSharing).not.toBeChecked();
    await contactSharing.check();
    await expect(contactSharing).toBeChecked();
    await page.reload();
    await expect(page.getByLabel('Let employers unlock my contact details')).toBeChecked();

    await page.goto('/candidate/profile/preview');
    await expect(page.getByText('Contact sharing is on')).toBeVisible();
    // And the preview no longer claims to be exactly what an employer sees:
    // an employer sees an anonymous card until they spend an unlock.
    await expect(page.getByText('without your name or email')).toBeVisible();
  });

  test('an unauthenticated visitor is redirected away from every candidate app route', async ({
    page,
  }) => {
    for (const path of ['/candidate/profile', '/candidate/onboarding', '/candidate/account']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/candidate\/sign-in$/);
    }
  });

  test('an incorrect code is rejected with a visible error', async ({ page }) => {
    const email = `e2e-wrong-code-${Date.now()}@example.com`;
    await page.goto('/candidate/sign-in');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send sign-in code' }).click();
    await page.getByLabel('Sign-in code').fill('000000');
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page.locator('#code-error')).toHaveText(/incorrect or has expired/i);
  });
});
