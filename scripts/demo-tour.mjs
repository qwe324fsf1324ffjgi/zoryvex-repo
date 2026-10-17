#!/usr/bin/env node
// Walks the whole product in a real browser and saves a numbered, captioned
// screenshot of every step.
//
// Built because the founder is not a developer and asked to see how the thing
// works. Reading the code is not an answer to that, and neither is a written
// list of clicks: the point is to watch it happen. This drives the same
// browser Playwright already drives for the e2e suite, against the same local
// demo data, so what it shows is the real product rather than a mockup of it.
//
// Everything here runs on `packages/local-adapters`' fixtures. No AWS, no
// credentials, no real Paystack, no real email. The payment step is the demo
// build's own simulated handoff, which is why it can be shown at all.
//
//   npm run demo:tour
//
// Screenshots land in demo-tour/ as 01-....png, in the order below, each one
// paired with a line in demo-tour/README.md saying what it shows and what it
// proves.

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'demo-tour');
const BASE = process.env.DEMO_BASE_URL ?? 'http://localhost:4173';

const steps = [];
let stepNumber = 0;

/** Saves a screenshot and records what a viewer is looking at. */
async function shot(page, slug, title, explanation) {
  stepNumber += 1;
  const file = `${String(stepNumber).padStart(2, '0')}-${slug}.png`;
  await page.screenshot({ path: join(OUT, file), fullPage: true });
  steps.push({ file, title, explanation });
  console.log(`  ${String(stepNumber).padStart(2, ' ')}. ${title}`);
}

/**
 * The demo build shows the sign-in code on screen rather than emailing it,
 * which is the only reason a person can get into it at all.
 */
async function signIn(page, path, email, expectUrl) {
  await page.goto(`${BASE}${path}`);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send sign-in code' }).click();
  const notice = await page.getByText(/Your code is/).innerText();
  const code = /\b(\d{6})\b/.exec(notice)?.[1];
  if (!code) throw new Error(`no demo code on screen: ${notice}`);
  await page.getByLabel('Sign-in code').fill(code);
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await page.waitForURL(expectUrl);
  return code;
}

async function tourMarketing(page) {
  await page.goto(BASE);
  await shot(
    page,
    'home',
    'The promise, in one line',
    'Proof you can check yourself, not a profile you have to believe. Everything below exists to make that sentence literally true: every verified claim links back to the issuer’s own record, so an employer never has to take Zoryvex’s word for anything.',
  );

  await page.goto(`${BASE}/how-verification-works`);
  await shot(
    page,
    'verification-states',
    'What "proof" actually means here',
    'Three states, and only the third is a check. Note that a verification expires: a certification that lapses stops counting on its own, checked every time an employer looks. That is what makes the word mean something different here than a badge that is granted once and never revisited.',
  );

  await page.goto(`${BASE}/pricing`);
  await shot(
    page,
    'pricing',
    'What an employer pays, and what they do not',
    'Candidates are free, permanently. The Kit is one-time per role, NGN 95,000, and works with zero candidates in the marketplace. Subscriptions are separate and only make sense once real matches exist. Each tier shows the founding price, the standard price, and the exact monthly saving between them.',
  );
}

async function tourCandidate(page) {
  await signIn(page, '/candidate/sign-in', 'newstarter@example.com', /\/candidate/);
  await shot(
    page,
    'candidate-onboarding',
    'A brand-new candidate, signed up in one step',
    'No password, no CV upload. The first decision is one launch track, and only one: a proof profile focused on the work the candidate actually wants to be hired for. This account did not exist thirty seconds ago.',
  );

  await page.getByLabel('DevOps/platform').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Display name').fill('Demo Candidate');
  await page.waitForTimeout(600);
  await shot(
    page,
    'candidate-profile-empty',
    'The profile before anything is filed',
    'Deliberately empty, and it says where you stand: employers cannot see you yet. There is nothing here to pad out with a job title or a summary of adjectives, because none of that is checkable.',
  );

  await page.getByRole('link', { name: 'File a claim' }).click();
  await page.getByRole('radio', { name: 'Link to it' }).check();
  await page.getByLabel('Claim').fill('Cut release time from a full day to twenty minutes');
  await page.getByLabel('Context').fill('Every release needed a person walking it through by hand');
  await page.getByLabel('Actions').fill('Built the pipeline end to end, with rollback');
  await page.getByLabel('Outcome').fill('Releases went from one a week to several a day');
  await shot(
    page,
    'candidate-evidence-form',
    'Four lines, then a check',
    'Claim, context, actions, outcome. The third is the hard one: what you personally did, not the team, because that is the line a check can confirm. A résumé bullet like "improved deployments" cannot be confirmed by anybody, and these can.',
  );

  await page.getByLabel('Visibility', { exact: true }).selectOption('discovery');
  await page.getByLabel(/I consent/).check();
  await page.getByRole('button', { name: 'File this claim' }).click();
  await page.waitForTimeout(400);
  await shot(
    page,
    'candidate-evidence-saved',
    'Filed, and not yet proved',
    'It says so plainly, with a mark that shows nothing has been checked. A claim is something you say; it scores zero until a source you do not control confirms it. This is the state most claims on most hiring platforms stay in permanently, without ever saying so.',
  );

  await page.goto(`${BASE}/candidate/evidence/verify`);
  await shot(
    page,
    'candidate-verify-options',
    'Three ways to turn a claim into proof',
    'An issuer badge checked with the organisation that issued it, repository ownership proved with a one-time nonce, or a graded practical task. All three are checks a machine can re-run and get the same answer from, which is the only kind that scales past one reviewer’s working hours.',
  );

  await page.goto(`${BASE}/candidate/profile`);
  await page.getByLabel('Opt into employer discovery').check();
  await page.getByLabel('Let employers unlock my contact details').check();
  await page.waitForTimeout(300);
  await shot(
    page,
    'candidate-consents',
    'Two separate consents, because they are two different things',
    'Being findable and being contactable are not the same decision, and the platform does not bundle them. The second one is the switch the server checks before any employer can spend an unlock: without it, every request to reach this person is refused outright.',
  );

  await page.goto(`${BASE}/candidate/profile/preview`);
  await shot(
    page,
    'candidate-employer-view',
    'What an employer actually sees',
    'The evidence, and no name or email. Both stay behind a short id until an employer spends one of their monthly contact unlocks, and the candidate is told when that happens. This page exists so nobody has to take that on trust.',
  );

  await page.goto(`${BASE}/candidate/account`);
  await shot(
    page,
    'candidate-control',
    'The candidate holds the controls',
    'Switching discovery off withdraws them from every open match immediately. Data can be exported or deleted, and deletion means deleted rather than hidden.',
  );
}

async function tourEmployerNewRole(page) {
  await signIn(page, '/employer/sign-in', 'newemployer@example.com', /\/employer$/);
  await shot(
    page,
    'employer-empty',
    'A brand-new employer, with nothing bought',
    'No trial, no card, no sales call. An employer can go this far, and the next two steps as well, without paying anything.',
  );

  await page.goto(`${BASE}/employer/roles/new`);
  await page.getByLabel('AWS cloud').check();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Role title').fill('Senior Cloud Engineer');
  await page.getByLabel('Outcomes').fill('Own a multi-account AWS landing zone within 60 days.');
  await page
    .getByLabel('Must-have work (one per line)')
    .fill('Has built a multi-account AWS landing zone\nHas run a real production incident');
  await shot(
    page,
    'employer-role-form',
    'Describing the role in terms of work, not keywords',
    'Outcomes and must-have work, not years of experience and a list of tools. What goes in here is what the Kit and the matching are both built from, which is why it asks for the thing that can be evidenced.',
  );

  await page.getByRole('button', { name: 'See the free preview' }).click();
  await page.waitForTimeout(400);
  await shot(
    page,
    'employer-free-preview',
    'The free preview, and the moment the product makes its case',
    'It names exactly what this employer cannot currently verify about their own shortlist. Useful on its own, deliberately incomplete, and free forever. This is where an employer discovers they have a problem they had not named.',
  );
}

async function tourKitPurchase(page) {
  await page.getByRole('link', { name: 'View role & get the Kit' }).click();
  await page.waitForTimeout(300);
  await shot(
    page,
    'employer-role-unpurchased',
    'The role before buying anything',
    'Kit not purchased, no matches yet. Nothing is hidden behind a teaser and nothing is upsold: the marketplace is not even offered for this role, for the reason shown a few steps further on.',
  );

  await page.getByRole('link', { name: 'Get the Kit' }).click();
  await page.waitForTimeout(300);
  await shot(
    page,
    'employer-checkout',
    'Everything stated before any money moves',
    "Price, what you get, what it does not cover, and how a refund works, all before the button. Payments are processed by Paystack under the business name Abba's Solutions, which is disclosed here and on every other paid surface.",
  );

  await page.getByRole('button', { name: 'Continue to Paystack' }).click();
  await page.waitForTimeout(300);
  await shot(
    page,
    'employer-payment-simulated',
    'The payment handoff, simulated in this demo',
    'A real build redirects to Paystack’s own hosted checkout and comes back. This demo build simulates both outcomes so the failure path can be shown too, which matters: a failed payment must leave the role unpurchased rather than half-purchased.',
  );

  await page.getByRole('button', { name: 'Simulate payment succeeded' }).click();
  await page.waitForTimeout(600);
  await shot(
    page,
    'employer-kit-delivered',
    'The Kit, generated for this specific role',
    'Six deliverables, written from the role that was described two steps ago: success profile, evidence checklist, claim-verification matrix, assessment rubric, interview guide, decision scorecard. It prints to PDF from the browser. There is no other service involved and nothing else to buy for this role.',
  );
}

async function tourMatching(page) {
  await signIn(page, '/employer/sign-in', 'hiring.demo@example.com', /\/employer$/);
  await page.goto(`${BASE}/employer/role?id=role_sre`);
  await page.waitForTimeout(400);
  await shot(
    page,
    'gate-closed',
    'A role that has not earned a marketplace yet',
    'Fewer than five real, opted-in matching candidates, so the paid marketplace is not offered at all. The gate is enforced on the server as well as on this page, so it is not something a browser can be talked out of: an employer is never sold access to supply that does not exist.',
  );

  await page.goto(`${BASE}/employer/role/edit?id=role_sre`);
  await page.waitForTimeout(400);
  await shot(
    page,
    'employer-edit-role',
    'A role can be corrected',
    'Must-have work is what matching scores against, so a typo in it produces the wrong shortlist. The launch track is the one thing that cannot be changed here, and the page says why: it decides which candidates the role is matched against at all, so changing it would be a different role rather than a correction.',
  );

  await page.goto(`${BASE}/employer/role?id=role_platform_lead`);
  await page.waitForTimeout(400);
  await shot(
    page,
    'gate-open-matches',
    'A role with real matches, ranked and explained',
    'Every candidate here is opted in and has verified evidence supporting this role’s requirements. Unverified claims score exactly zero, so nothing on this list is ranked on a promise.',
  );

  const whatWeChecked = page.getByRole('button', { name: /What we checked/ }).first();
  if (await whatWeChecked.isVisible().catch(() => false)) {
    await whatWeChecked.click();
    await page.waitForTimeout(400);
    await shot(
      page,
      'evidence-behind-a-match',
      'The proof behind one match, checkable at the source',
      'The claim, how it was checked, when, and a link to the issuer’s own record. That last link is the entire product: an employer can confirm it themselves, without an account and without Zoryvex in the middle.',
    );
  }
}

async function tourSubscriptions(page) {
  await page.goto(`${BASE}/employer/billing`);
  await page.waitForTimeout(400);
  await shot(
    page,
    'billing-before',
    'Subscriptions, and what they are actually for',
    'The Kit is bought per role. A subscription buys contact reaches into the marketplace each month, which only becomes worth anything once a role has real matches. Founding pricing is capped at the first 25 organisations and is kept for the life of the subscription.',
  );

  const subscribe = page.getByRole('button', { name: /^Subscribe to / }).first();
  if (await subscribe.isVisible().catch(() => false)) {
    await subscribe.click();
    await page.waitForTimeout(600);
    await shot(
      page,
      'billing-active',
      'An active plan, cancellable from the same screen',
      'It shows the price this organisation actually holds, not the list price. Founding members keep theirs for the life of the subscription, so the number on this card is the promise. No notice period, no annual contract, no phone call to leave.',
    );
  }

  await page.goto(`${BASE}/employer/role?id=role_platform_lead`);
  await page.waitForTimeout(500);
  await shot(
    page,
    'contact-unlock',
    'Spending one contact reach',
    'Unlocking contact details is a server-side transaction, never something the browser can assert. It requires this employer to own the role, a real match to exist, the candidate to have consented, and allowance to remain. Two simultaneous unlocks cannot both get past the limit.',
  );
}

async function tourAdmin(page) {
  await signIn(page, '/admin/sign-in', 'founder.demo@example.com', /\/admin/);
  await page.goto(`${BASE}/admin`);
  await page.waitForTimeout(400);
  await shot(
    page,
    'admin',
    'What the founder sees',
    'An exception queue rather than a dashboard: unresolved audit items and things needing attention. Deliberately not a wall of vanity numbers, because nobody makes a decision from those.',
  );
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  console.log(`Touring ${BASE}\n`);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  try {
    await page.goto(BASE);
    // The demo-data banner covers the top of every page and would sit in every
    // screenshot. Its point is made once, in the written guide.
    await page
      .getByRole('button', { name: 'Dismiss' })
      .click({ timeout: 3000 })
      .catch(() => {});

    await tourMarketing(page);
    await tourCandidate(page);
    await tourEmployerNewRole(page);
    await tourKitPurchase(page);
    await tourMatching(page);
    await tourSubscriptions(page);
    await tourAdmin(page);
  } finally {
    await browser.close();
  }

  const readme = [
    '# Zoryvex, end to end',
    '',
    'Every image here is the real product running on demo data. No mockups.',
    'Regenerate with `npm run demo:tour`.',
    '',
    ...steps.flatMap((s, i) => [
      `## ${i + 1}. ${s.title}`,
      '',
      `![${s.title}](./${s.file})`,
      '',
      s.explanation,
      '',
    ]),
  ].join('\n');
  await writeFile(join(OUT, 'README.md'), readme, 'utf8');

  console.log(`\n${steps.length} steps captured in demo-tour/`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
