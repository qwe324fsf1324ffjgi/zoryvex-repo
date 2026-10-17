import { KIT_PRICE_NGN, SUBSCRIPTION_PRICES_NGN } from '@zoryvex/contracts';
import { expect, test, type Page } from '@playwright/test';
import { readSignInCode } from '../support/outbox';

/**
 * Derived, never written out. Three specs used to assert the literal
 * "NGN 29,000", which meant a price change broke the end-to-end suite in
 * places that had nothing to do with pricing, and told you so only after a
 * full Playwright run.
 */
const KIT_PRICE_TEXT = `NGN ${KIT_PRICE_NGN.toLocaleString('en-NG')}`;

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/employer/sign-in');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send sign-in code' }).click();
  // Longer than the 5s default on purpose. This is the first assertion after
  // a state transition on a freshly served page, and under a full parallel
  // run - desktop and mobile projects at once - it has come in over the
  // default while every isolated run passes. Failing here says nothing about
  // the product, and a flaky sign-in helper fails whichever test happens to
  // run when the machine is busiest, which is how a green suite starts being
  // re-run rather than read.
  await expect(page.getByText(email)).toBeVisible({ timeout: 15_000 });
  const code = await readSignInCode(page, email);
  await page.getByLabel('Sign-in code').fill(code);
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL(/\/employer$/);
  // Wait for the guarded app shell to actually render, not just the URL to
  // change — confirms the session round-tripped through localStorage before
  // any subsequent hard navigation, which a bare URL match doesn't guarantee.
  await expect(page.getByRole('navigation', { name: 'Employer' })).toBeVisible();
}

test.describe('Employer journey: onboarding through Kit purchase', () => {
  test('sign up, set up org, invite teammates, create a role, preview, buy the Kit', async ({
    page,
  }) => {
    const email = `e2e-employer-${Date.now()}@example.com`;
    await signIn(page, email);

    // New account lands straight on the roles dashboard, empty.
    await expect(page).toHaveURL(/\/employer$/);
    await expect(page.getByText('No roles yet')).toBeVisible();

    // --- Onboarding: org name ---
    await page.goto('/employer/onboarding');
    await page.getByLabel('Organization name').fill('E2E Test Org');
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page).toHaveURL(/\/employer$/);

    // --- Invite teammates: over the batch limit shows a 429 state ---
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
    await expect(page.getByText(/Invite up to 5 teammates per batch/i)).toBeVisible();

    // --- Invite within the limit succeeds ---
    await page.locator('#invite-emails').fill('teammate@example.com');
    await page.getByRole('button', { name: 'Send invites' }).click();
    await expect(page.getByText('Invited 1 teammate(s).')).toBeVisible();

    // --- Create a role (3-step wizard) ---
    await page.goto('/employer/roles/new');
    await page.getByLabel('Cloud engineering').check();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel('Role title').fill('E2E Cloud Engineer');
    await page.getByLabel('Outcomes').fill('Ship a working landing zone in 60 days.');
    await page
      .getByLabel('Must-have work (one per line)')
      .fill('Has built a multi-account AWS landing zone');
    await page.getByRole('button', { name: 'See the free preview' }).click();

    // --- Free preview: names the gap, does not give the full Kit content ---
    await expect(page.getByText(/you'll need evidence of 1 specific thing/i)).toBeVisible();
    await expect(page.getByText('Has built a multi-account AWS landing zone')).toBeVisible();
    await expect(page.getByText('Claim-verification matrix')).not.toBeVisible();

    // --- Role detail: not purchased yet, zero matches (empty state) ---
    await page.getByRole('link', { name: 'View role & get the Kit' }).click();
    await expect(page).toHaveURL(/\/employer\/role\?id=/);
    await expect(page.getByText('Not purchased yet for this role.')).toBeVisible();
    await expect(page.getByText('No matches yet')).toBeVisible();

    // --- Kit checkout: simulate a succeeded payment ---
    await page.getByRole('link', { name: 'Get the Kit' }).click();
    await expect(page).toHaveURL(/\/employer\/role\/checkout\?id=/);
    await expect(page.getByText(KIT_PRICE_TEXT)).toBeVisible();
    await expect(page.getByText('One-time. Not a subscription.')).toBeVisible();
    await page.getByRole('button', { name: 'Continue to Paystack' }).click();
    await page.getByRole('button', { name: 'Simulate payment succeeded' }).click();

    // --- Back on role detail: deliverables now render ---
    await expect(page).toHaveURL(/\/employer\/role\?id=/);
    await expect(page.getByText('Purchased. Deliverables below.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Role success profile' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Evidence checklist' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Claim-verification matrix' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Practical assessment rubric' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Structured interview guide' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Decision scorecard' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print / save as PDF' })).toBeVisible();
  });

  test('a failed Kit payment leaves the role unpurchased', async ({ page }) => {
    const email = `e2e-failed-payment-${Date.now()}@example.com`;
    await signIn(page, email);

    await page.goto('/employer/roles/new');
    await page.getByLabel('Cloud-security/DevSecOps').check();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel('Role title').fill('E2E Security Engineer');
    await page.getByLabel('Outcomes').fill('Close last quarter’s findings.');
    await page.getByLabel('Must-have work (one per line)').fill('Has closed a real finding');
    await page.getByRole('button', { name: 'See the free preview' }).click();
    await page.getByRole('link', { name: 'View role & get the Kit' }).click();
    await expect(page).toHaveURL(/\/employer\/role\?id=/);
    await expect(page.getByText('Not purchased yet for this role.')).toBeVisible();

    await page.getByRole('link', { name: 'Get the Kit' }).click();
    await expect(page).toHaveURL(/\/employer\/role\/checkout\?id=/);
    await page.getByRole('button', { name: 'Continue to Paystack' }).click();
    await page.getByRole('button', { name: 'Simulate payment failed' }).click();

    await expect(page).toHaveURL(/\/employer\/role\?id=/);
    await expect(page.getByText('Not purchased yet for this role.')).toBeVisible();
    await expect(page.getByText('Purchased. Deliverables below.')).not.toBeVisible();
  });

  test('an unauthenticated visitor is redirected away from every employer app route', async ({
    page,
  }) => {
    for (const path of [
      '/employer',
      '/employer/onboarding',
      '/employer/roles/new',
      '/employer/billing',
    ]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/employer\/sign-in$/);
    }
  });

  test('an incorrect code is rejected with a visible error', async ({ page }) => {
    const email = `e2e-wrong-code-${Date.now()}@example.com`;
    await page.goto('/employer/sign-in');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send sign-in code' }).click();
    await page.getByLabel('Sign-in code').fill('000000');
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page.locator('#code-error')).toHaveText(/incorrect or has expired/i);
  });

  test('a role with no subscription allowance shows an upgrade prompt instead of unlock', async ({
    page,
  }) => {
    // hiring.demo@example.com bought only the Kit for this role (fixture) —
    // no marketplace subscription, so the allowance is 0 even though the
    // gate is open and 5 matches exist.
    await signIn(page, 'hiring.demo@example.com');
    await page.goto('/employer/role?id=role_platform_lead');

    await expect(page.getByText('Purchased. Deliverables below.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unlock contact' })).toHaveCount(0);
    await expect(page.getByText('No contact unlocks remaining').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Upgrade plan' }).first()).toBeVisible();
  });

  test('a subscriber can see the price they hold, and that it is a founding one', async ({
    page,
  }) => {
    // The billing page used to show "Team · active" and nothing else, on a
    // product whose strongest commercial promise is that a founding member
    // keeps their price. The price was recorded nowhere and displayed
    // nowhere, so nothing could have honoured it and nobody could have
    // checked it.
    await signIn(page, 'hiring.demo@example.com');
    await page.goto('/employer/billing');

    // Founding places are open in the fixtures, so the quote is the founding
    // price rather than the standard one shown on the marketing page.
    const scout = page.getByRole('button', { name: 'Subscribe to Scout' });
    await expect(scout).toBeVisible();
    await expect(page.getByText('A founding place.').first()).toBeVisible();

    await scout.click();
    // The current founding price, because this subscription is created during
    // the test by clicking Subscribe rather than read from a fixture. A member
    // who subscribed before the 2026-09-02 raise keeps their older price, and
    // that grandfathering is asserted in admin-journey against the fixture
    // that holds it. Two different claims, two different sources.
    const heldText = SUBSCRIPTION_PRICES_NGN.scout.founding.toLocaleString('en-NG');
    await expect(
      page.getByText(new RegExp(`Scout · active · NGN\\s?${heldText}/month`, 'i')),
    ).toBeVisible();
    await expect(page.getByText(/You hold a founding place/i)).toBeVisible();
  });

  test('gate-open role with an active subscription: contact unlock and an already-unlocked conflict', async ({
    page,
  }) => {
    await signIn(page, 'hiring.demo@example.com');

    // Subscribe first — the Kit alone grants no contact-unlock allowance.
    await page.goto('/employer/billing');
    await page.getByRole('button', { name: 'Subscribe' }).first().click();
    await expect(page.getByText(/Scout · active/i)).toBeVisible();

    await page.goto('/employer/role?id=role_platform_lead');
    await expect(page.getByText('Purchased. Deliverables below.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Role success profile' })).toBeVisible();

    // Five matches, but only four are contactable: one candidate is happy to
    // be found and not to be emailed, and the two consents are separate. That
    // card offers no button at all rather than letting an employer spend an
    // unlock to discover the refusal.
    const unlockButtons = page.getByRole('button', { name: 'Unlock contact' });
    await expect(unlockButtons).toHaveCount(4);
    await expect(
      page.getByText('This candidate has not agreed to share contact details.'),
    ).toBeVisible();

    // --- Unlock the first candidate ---
    await unlockButtons.first().click();
    await page.getByRole('button', { name: 'Yes, unlock' }).click();
    await expect(page.getByText(/^Contact unlocked ·/).first()).toBeVisible();
    await expect(unlockButtons).toHaveCount(3);
    await expect(page.getByText('1 / 5 contact unlocks used this period')).toBeVisible();

    // --- Simulate a race: the same match gets unlocked by another tab/device
    // between opening this dialog and confirming it. ---
    await unlockButtons.first().click();
    await page.evaluate(() => {
      const adapters = window.__zoryvexLocalAdapters;
      if (!adapters) throw new Error('local adapters not exposed on window');
      // The match whose dialog is open: the strongest one still locked. This
      // used to index the store directly, which worked only while the page
      // rendered matches in store order. Once the list was sorted strongest
      // first, index 1 stopped being the card under the cursor and the race
      // was simulated against an unrelated candidate.
      const stale = adapters.data
        .listMatchesForRole('role_platform_lead')
        .filter((m) => !m.contactUnlocked)
        .sort(
          (a, b) => b.matchScore - a.matchScore || a.candidateId.localeCompare(b.candidateId),
        )[0]!;
      adapters.data.upsertMatch({ ...stale, contactUnlocked: true, status: 'contacted' });
    });
    await page.getByRole('button', { name: 'Yes, unlock' }).click();
    await expect(page.getByText("This candidate's contact was already unlocked.")).toBeVisible();
  });

  test('a role can be corrected after it is created', async ({ page }) => {
    // Roles were create-only. PATCH /roles/{id} has existed since Phase 7 and
    // nothing called it, so an employer who mistyped a must-have requirement
    // could either live with the wrong matches or create a second role and
    // buy a second Kit at the same price.
    await signIn(page, 'hiring.demo@example.com');
    await page.goto('/employer/role?id=role_platform_lead');
    await page.getByRole('link', { name: 'Edit role' }).click();
    await expect(page).toHaveURL(/\/employer\/role\/edit\?id=role_platform_lead$/);

    const title = page.getByLabel('Role title');
    await expect(title).toHaveValue('Platform Lead');
    await title.fill('Staff Platform Lead');
    await page.getByLabel('Must-have work (one per line)').fill('Ran a multi-account landing zone');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page).toHaveURL(/\/employer\/role\?id=role_platform_lead$/);
    await expect(page.getByRole('heading', { name: 'Staff Platform Lead' })).toBeVisible();
  });

  test('the launch track cannot be changed by editing a role', async ({ page }) => {
    // Changing it would silently repoint the role at a different pool of
    // candidates, so it is a new role rather than a correction — and the
    // server's UpdateRoleInput does not accept it either.
    await signIn(page, 'hiring.demo@example.com');
    await page.goto('/employer/role/edit?id=role_platform_lead');
    await expect(page.getByText('The track decides which candidates')).toBeVisible();
    // Asserted by role rather than by the legend's wording. `getByLabel` with
    // a literal string passes the moment that string stops existing for any
    // reason, so when the legend was reworded this assertion would have gone
    // on passing while testing nothing at all. A radiogroup is what the
    // control actually is, and there must not be one on this page.
    await expect(page.getByRole('radiogroup')).toHaveCount(0);
    // And the value is still shown, so the absence above is "not editable"
    // rather than "not there". Without this, deleting the whole section
    // would also pass.
    //
    // Matched on the "Track:" line rather than on a particular label,
    // because which track this fixture carries is not what this test is
    // about and the labels themselves are a founder decision that may still
    // change. Naming one here would make an unrelated copy edit fail this.
    await expect(page.getByText(/^Track: \S/)).toBeVisible();
  });

  test('editing rejects a role left with no must-have work', async ({ page }) => {
    await signIn(page, 'hiring.demo@example.com');
    await page.goto('/employer/role/edit?id=role_platform_lead');
    await page.getByLabel('Must-have work (one per line)').fill('   ');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Add at least one must-have work item.')).toBeVisible();
    await expect(page).toHaveURL(/\/employer\/role\/edit/);
  });

  test('a role with matches is open for contact once the gate is one', async ({ page }) => {
    // This asserted the gate-closed partial list until 2026-09-02, when the
    // founder lowered the gate from five matches to one. role_sre has four,
    // so it is open now, and the only closed state left is a role with no
    // matches at all — covered by the zero-match test below.
    await signIn(page, 'talent.demo@example.com');
    await page.goto('/employer/role?id=role_sre');

    await expect(page.getByText('Payment pending.')).toBeVisible();
    await expect(page.getByText(/of 5 needed/)).toHaveCount(0);
    // The strength is stated as what it measures rather than as a bare
    // "% match", which invited the reader to imagine a similarity engine
    // that does not exist here. It is the share of the employer's own
    // must-have work that verified proof supports.
    await expect(page.getByText(/must-have requirement/).first()).toBeVisible();
  });

  test('billing: an active subscription can be viewed and canceled', async ({ page }) => {
    await signIn(page, 'talent.demo@example.com');
    await page.goto('/employer/billing');
    await page.getByRole('button', { name: 'Subscribe' }).nth(1).click(); // Founding Team
    await expect(page.getByText(/Team · active/i)).toBeVisible();

    await page.getByRole('button', { name: 'Cancel subscription' }).click();
    await page.getByRole('button', { name: 'Yes, cancel' }).click();
    await expect(page.getByText('No active marketplace subscription')).toBeVisible();
  });

  test('billing: no active subscription shows founding tiers and Kit order history', async ({
    page,
  }) => {
    await signIn(page, 'hiring.demo@example.com');
    await page.goto('/employer/billing');

    await expect(page.getByText('No active marketplace subscription')).toBeVisible();
    await expect(page.getByText(KIT_PRICE_TEXT)).toBeVisible();
    await expect(page.getByText('succeeded')).toBeVisible();

    await page.getByRole('button', { name: 'Subscribe' }).first().click();
    await expect(page.getByText(/Scout · active/i)).toBeVisible();
  });
});
