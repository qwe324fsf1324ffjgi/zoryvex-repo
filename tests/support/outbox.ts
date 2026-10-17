import type { Page } from '@playwright/test';

/**
 * Reads the sign-in code out of the local demo outbox, waiting for the
 * message that belongs to the person signing in.
 *
 * Ten spec files each carried their own copy of this, and every copy read
 * `sent[sent.length - 1]` the instant after clicking "Send sign-in code".
 * Nothing waited for that click to produce anything, so when the machine was
 * busy the read landed before the new message existed and returned the
 * PREVIOUS test's code. That code is valid, for a different account, and one
 * that has usually finished onboarding, so the sign-in succeeded and the app
 * quite correctly went somewhere else. The failure then surfaced as an
 * unrelated assertion much further down: a URL that should have been
 * /candidate/onboarding arriving as /candidate/profile, or a live region
 * empty because the page belonged to somebody else.
 *
 * That is the shape of most of the intermittent mobile failures seen while
 * this branch was being built, and the reason each of them passed on its own
 * and failed only in a full run.
 *
 * Waiting for a message addressed to `expectedTo` fixes both halves: it
 * cannot return early, and it cannot return somebody else's code.
 */
export async function readSignInCode(page: Page, expectedTo: string): Promise<string> {
  const handle = await page.waitForFunction(
    (address) => {
      const adapters = window.__zoryvexLocalAdapters;
      if (!adapters) return null;
      const sent = adapters.email.listSent();
      // Newest first: an address is reused within a test when a second code
      // is requested, and the later message is the live one.
      for (let i = sent.length - 1; i >= 0; i -= 1) {
        const message = sent[i];
        if (message && message.to === address) return message.bodyPreview;
      }
      return null;
    },
    expectedTo,
    { timeout: 15_000 },
  );

  const bodyPreview = (await handle.jsonValue()) as string;
  const match = bodyPreview.match(/code is (\d{6})/);
  if (!match) throw new Error(`no sign-in code found in message to ${expectedTo}: ${bodyPreview}`);
  return match[1]!;
}
