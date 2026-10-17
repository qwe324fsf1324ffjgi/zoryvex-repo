import { test, expect, type Page } from '@playwright/test';

/**
 * A measuring pass over every route, at both viewports.
 *
 * Not a replacement for the accessibility suite, which runs axe and covers
 * contrast, names, roles and landmarks. This checks the things axe does not:
 * whether anything overflows the viewport sideways, whether any control is
 * below WCAG 2.2's 24px target floor, and whether a disabled control says
 * why it is disabled.
 *
 * That last one is a rule this codebase already applies by hand in several
 * places ("Add the link to your gist in step 2 and this turns on"). A
 * disabled control with no reason beside it is indistinguishable from a
 * broken one, which is the single most common complaint about this app.
 */

const PUBLIC_ROUTES = [
  '/',
  '/for-talent',
  '/for-employers',
  '/how-verification-works',
  '/pricing',
  '/trust-safety',
  '/founder',
  '/contact',
  '/accessibility',
  '/privacy',
  '/terms',
  '/cookies',
  '/status',
  '/sign-in',
  '/candidate/sign-in',
  '/employer/sign-in',
  '/admin/sign-in',
];

const CANDIDATE_ROUTES = [
  '/candidate/profile',
  '/candidate/profile/preview',
  '/candidate/account',
  '/candidate/evidence/new',
  '/candidate/evidence/verify?id=ev_amara_1',
];

const EMPLOYER_ROUTES = [
  '/employer',
  '/employer/roles/new',
  '/employer/billing',
  '/employer/role?id=role_platform_lead',
  '/employer/role/edit?id=role_platform_lead',
];

interface Finding {
  kind: string;
  detail: string;
}

async function measure(page: Page): Promise<Finding[]> {
  return page.evaluate(() => {
    const vis = (e: Element) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const label = (e: Element) =>
      (e.getAttribute('aria-label') || e.textContent || (e as HTMLInputElement).id || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 44);

    const found: { kind: string; detail: string }[] = [];
    const doc = document.documentElement;

    if (doc.scrollWidth > window.innerWidth + 1) {
      found.push({
        kind: 'H-OVERFLOW',
        detail: `page is ${doc.scrollWidth}px wide in a ${window.innerWidth}px viewport`,
      });
      for (const e of Array.from(document.querySelectorAll('body *'))) {
        if (!vis(e)) continue;
        const r = e.getBoundingClientRect();
        if (r.right > window.innerWidth + 1 && e.children.length === 0) {
          found.push({
            kind: 'OVERFLOWING-ELEMENT',
            detail: `<${e.tagName.toLowerCase()}> reaches ${Math.round(r.right)}px "${label(e)}"`,
          });
        }
      }
    }

    /*
      WCAG 2.2 SC 2.5.8 exempts a target that sits inside a sentence, because
      its size is constrained by the line-height of the text around it. So the
      question is not "is this link small" but "is this link alone".

      A link whose parent contains nothing but the link is a standalone
      control and the exception does not cover it. A link inside a paragraph
      of other words is exempt however small it measures.

      For a checkbox or radio the clickable label is part of the target, so
      the union of the input and its label is what gets measured, not the box.
    */
    const targetBox = (e: Element): { w: number; h: number } => {
      const r = e.getBoundingClientRect();
      const input = e as HTMLInputElement;
      if (input.type === 'checkbox' || input.type === 'radio') {
        const lab = input.id
          ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`)
          : null;
        if (lab) {
          const lr = lab.getBoundingClientRect();
          return {
            w: Math.max(r.right, lr.right) - Math.min(r.left, lr.left),
            h: Math.max(r.bottom, lr.bottom) - Math.min(r.top, lr.top),
          };
        }
      }
      return { w: r.width, h: r.height };
    };

    const isInlineInSentence = (e: Element): boolean => {
      if (e.tagName !== 'A') return false;
      const parentText = (e.parentElement?.textContent ?? '').replace(/\s+/g, ' ').trim();
      const own = (e.textContent ?? '').replace(/\s+/g, ' ').trim();
      // Some other words share the parent, so this link sits in running text.
      return parentText.length > own.length + 3;
    };

    for (const e of Array.from(
      document.querySelectorAll('button,a[href],input,select,textarea,[role=button]'),
    )) {
      if (!vis(e)) continue;
      const raw = e.getBoundingClientRect();
      // A 1x1 visually-hidden skip link is a deliberate, standard technique.
      if (raw.width <= 2 && raw.height <= 2) continue;
      if (isInlineInSentence(e)) continue;
      const box = targetBox(e);
      if (box.h < 24 || box.w < 24) {
        found.push({
          kind: 'TARGET-UNDER-24',
          detail: `${Math.round(box.w)}x${Math.round(box.h)} <${e.tagName.toLowerCase()}> "${label(e)}"`,
        });
      }
    }

    for (const e of Array.from(
      document.querySelectorAll(
        'button[disabled],input[disabled],select[disabled],textarea[disabled]',
      ),
    )) {
      if (!vis(e)) continue;
      const describedId = e.getAttribute('aria-describedby');
      const hint = describedId ? (document.getElementById(describedId)?.textContent ?? '') : '';
      const surrounding = e.closest('div,fieldset,form')?.textContent ?? '';
      const explains = /turns on|choose |select |first|required|consent|wait|add |finish/i.test(
        `${hint} ${surrounding}`,
      );
      if (!explains) {
        found.push({
          kind: 'DISABLED-UNEXPLAINED',
          detail: `<${e.tagName.toLowerCase()}> "${label(e)}"`,
        });
      }
    }

    return found;
  });
}

async function signIn(page: Page, kind: 'candidate' | 'employer') {
  const session =
    kind === 'candidate'
      ? { accountId: 'acct_amara', candidateId: 'cand_amara', role: 'candidate' }
      : { accountId: 'acct_northwind', employerId: 'emp_northwind', role: 'employer' };
  await page.goto('/');
  await page.evaluate((s) => {
    localStorage.setItem(
      'zoryvex:local:AUTH#SESSION',
      JSON.stringify({ ...s, issuedAt: new Date().toISOString() }),
    );
  }, session);
}

for (const viewport of [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 800 },
]) {
  test(`UI measurements at ${viewport.name}`, async ({ page }, testInfo) => {
    // This spec sets its own viewport for both sizes, so running it under
    // the mobile project as well would measure the same two viewports a
    // second time and add minutes to CI for nothing.
    test.skip(testInfo.project.name !== 'desktop', 'sets its own viewports; one project is enough');
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const all: string[] = [];

    for (const route of PUBLIC_ROUTES) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      for (const f of await measure(page)) all.push(`${route}  ${f.kind}  ${f.detail}`);
    }

    await signIn(page, 'candidate');
    for (const route of CANDIDATE_ROUTES) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      for (const f of await measure(page)) all.push(`${route}  ${f.kind}  ${f.detail}`);
    }

    await signIn(page, 'employer');
    for (const route of EMPLOYER_ROUTES) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      for (const f of await measure(page)) all.push(`${route}  ${f.kind}  ${f.detail}`);
    }

    // Every finding is in the failure message, one per line, so a red run
    // names the route, the kind and the measurement without needing logs.
    expect(all, all.join('\n')).toEqual([]);
  });
}
