import { expect, test, type Page } from '@playwright/test';
import { readSignInCode } from '../support/outbox';

/**
 * Regression guard for a real layout bug found in a 2026-08-27 audit.
 *
 * Role titles, candidate names and evidence claims are free text that users
 * type or paste. A single long unbroken token (a pasted URL, a long compound
 * word, a stress-test string) used to size the containing CSS Grid track and
 * flex items to its own width, because both `1fr` tracks and flex items
 * default to `min-width: auto` — "at least as wide as the content". Measured
 * at the time: the role detail page blew out to 4038px inside a 634px
 * viewport, with a horizontal scrollbar across the whole document.
 *
 * These tests assert the property that actually matters to a user — the page
 * never scrolls sideways — rather than asserting a specific CSS class, so
 * they stay valid if the styling is refactored.
 */

const UNBROKEN = 'X'.repeat(200);

async function signIn(page: Page, path: string, email: string, landing: RegExp) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send sign-in code' }).click();
  const code = await readSignInCode(page, email);
  await page.getByLabel('Sign-in code').fill(code);
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL(landing);
}

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const result = await page.evaluate(() => {
    const doc = document.scrollingElement ?? document.documentElement;
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
  });
  // A couple of pixels of slack for sub-pixel rounding; a real break is
  // hundreds or thousands of pixels, never one or two.
  expect(
    result.scrollWidth,
    `${label} scrolls horizontally (${result.scrollWidth}px content in ${result.clientWidth}px viewport)`,
  ).toBeLessThanOrEqual(result.clientWidth + 2);
}

test.describe('Long unbroken user content never breaks the layout', () => {
  test('employer roles list and role detail survive a 200-character title', async ({ page }) => {
    await signIn(page, '/employer/sign-in', 'hiring.demo@example.com', /\/employer$/);

    await page.evaluate((title) => {
      const adapters = window.__zoryvexLocalAdapters;
      if (!adapters) throw new Error('local adapters not exposed on window');
      const employer = adapters.data.listAllEmployers()[0]!;
      adapters.data.upsertRole({
        id: 'role_overflow_probe',
        employerId: employer.id,
        launchTrack: 'aws_cloud',
        title,
        seniority: 'senior',
        outcomes: 'Outcome',
        mustHaveWork: ['Has done the thing'],
        constraints: '',
        status: 'active',
        createdAt: new Date().toISOString(),
      });
    }, UNBROKEN);

    await page.goto('/employer');
    await expectNoHorizontalOverflow(page, 'employer roles list');

    await page.goto('/employer/role?id=role_overflow_probe');
    await expectNoHorizontalOverflow(page, 'employer role detail');
  });

  test('candidate profile and employer preview survive a long claim and display name', async ({
    page,
  }) => {
    await signIn(page, '/candidate/sign-in', 'amara.demo@example.com', /\/candidate\/profile$/);

    await page.evaluate((unbroken) => {
      const adapters = window.__zoryvexLocalAdapters;
      if (!adapters) throw new Error('local adapters not exposed on window');
      const candidate = adapters.data
        .listAllCandidates()
        .find((c) => c.email === 'amara.demo@example.com')!;
      const now = new Date().toISOString();
      adapters.data.upsertEvidence({
        id: 'ev_overflow_probe',
        candidateId: candidate.id,
        source: 'project',
        claim: unbroken,
        context: 'Context',
        actions: 'Actions',
        outcome: unbroken,
        verificationState: 'self_attested',
        visibility: 'discovery',
        consentGiven: true,
        createdAt: now,
        updatedAt: now,
      });
      adapters.data.upsertCandidate({ ...candidate, displayName: unbroken, updatedAt: now });
    }, UNBROKEN);

    await page.goto('/candidate/profile');
    await expectNoHorizontalOverflow(page, 'candidate profile');

    await page.goto('/candidate/profile/preview');
    await expectNoHorizontalOverflow(page, 'candidate employer-preview');
  });
});
