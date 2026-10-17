import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A buyer who clicks Subscribe twice must not start two checkouts.
 *
 * The server does its half correctly. Both checkout handlers require an
 * `Idempotency-Key`, and the repository writes the key item and the
 * payment attempt in one transaction with `attribute_not_exists`, so a
 * repeat of the same key is handed back the first attempt rather than
 * creating a second.
 *
 * The browser defeated it. Both call sites passed `crypto.randomUUID()`
 * inline at click time, so every click sent a different key and the
 * server saw genuinely different requests. Measured against the deployed
 * test API: three clicks on Subscribe produced three POSTs to
 * `/billing/subscription`. The button did render disabled — and that
 * changed nothing, because `disabled` comes from React state and all
 * three click handlers ran before the re-render.
 *
 * Two things fix it and both are checked here: a synchronous latch that
 * does not wait for a render, and a key that stays the same across
 * retries of the same intent.
 *
 * Read from the source because the alternative is a jsdom test of a
 * redirect to Paystack, and the thing being pinned is which value is
 * passed — visible in the text and nowhere else at runtime.
 */

const BILLING = join(
  import.meta.dirname,
  '..',
  'src',
  'components',
  'billing',
  'RealBillingPage.tsx',
);
const KIT_CHECKOUT = join(
  import.meta.dirname,
  '..',
  'app',
  'employer',
  '(app)',
  'role',
  'checkout',
  'page.tsx',
);

const CALL_SITES = [
  { name: 'subscription checkout', file: BILLING, call: 'realBilling.startSubscription(' },
  { name: 'Kit checkout', file: KIT_CHECKOUT, call: 'realKit.createOrder(' },
];

describe.each(CALL_SITES)('$name', ({ file, call }) => {
  const source = readFileSync(file, 'utf8');

  it('does not mint a new idempotency key inside the call', () => {
    const at = source.indexOf(call);
    expect(at, `${call} should be in this file`).toBeGreaterThan(-1);
    const line = source.slice(at, source.indexOf('\n', at));
    expect(
      line,
      'a fresh key per click is a different key on the retry, which is what the server uses to tell a retry from a new purchase',
    ).not.toContain('crypto.randomUUID()');
  });

  it('holds the key in a ref so a retry reuses it', () => {
    expect(source).toMatch(/useRef/);
    expect(source).toMatch(/checkoutKeys?\.current/);
  });

  it('latches synchronously rather than relying on a re-render', () => {
    expect(source).toMatch(/inFlight\.current/);
    // The latch must be read before the await, or two handlers both pass it.
    const guardAt = source.indexOf('if (inFlight.current) return;');
    const callAt = source.indexOf(call);
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(callAt);
  });

  it('releases the latch when the checkout fails, so the buyer can try again', () => {
    const callAt = source.indexOf(call);
    const after = source.slice(callAt);
    expect(after).toMatch(/catch[\s\S]{0,200}inFlight\.current = false/);
  });

  it('releases the latch when the page is restored by the back button', () => {
    expect(source).toMatch(/useResetOnRestore\([\s\S]{0,400}inFlight\.current = false/);
  });
});
