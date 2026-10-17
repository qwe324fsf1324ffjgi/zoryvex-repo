import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useResetOnRestore } from '../src/lib/use-reset-on-restore';

/**
 * The regression this exists for, reproduced rather than described.
 *
 * Three buttons hand the browser to Paystack with `window.location`. Each
 * sets a pending flag first so it cannot be pressed twice mid-redirect, and
 * each clears that flag only if the request throws. On success the page
 * leaves, so nothing clears it, and a buyer who presses Back is served the
 * page out of the back/forward cache with the frozen flag still set. The
 * button is dead. On the billing page every Subscribe button is dead, because
 * `disabled={startingPlan !== null}` is inside the loop over tiers.
 *
 * The harness below is the same shape as the real handlers: a flag set on
 * click, never cleared on the success path, and a second button disabled by
 * the same flag so the "other related buttons" half of the report is covered
 * too. If the hook stops working, the first assertion after the restore
 * fails, which is the actual user-visible symptom rather than a proxy for it.
 */

function bfcacheRestore() {
  // jsdom has no PageTransitionEvent constructor, and the property is
  // read-only on a real one, so the flag is attached to a plain Event. The
  // hook reads `event.persisted` and nothing else about the type.
  const event = Object.assign(new Event('pageshow'), { persisted: true });
  act(() => {
    window.dispatchEvent(event);
  });
}

function ordinaryPageShow() {
  const event = Object.assign(new Event('pageshow'), { persisted: false });
  act(() => {
    window.dispatchEvent(event);
  });
}

/** Two buttons gated by one flag, as the billing page gates every tier. */
function Checkout({ withFix }: { withFix: boolean }) {
  const [pending, setPending] = useState<string | null>(null);

  // Deliberately conditional so the same harness demonstrates the bug and the
  // fix. A test that only exercises the fixed path cannot show it fixed
  // anything.
  useResetOnRestore(() => {
    if (withFix) setPending(null);
  });

  return (
    <>
      <button type="button" disabled={pending !== null} onClick={() => setPending('scout')}>
        {pending === 'scout' ? 'Opening Paystack…' : 'Subscribe to Scout'}
      </button>
      <button type="button" disabled={pending !== null} onClick={() => setPending('team')}>
        {pending === 'team' ? 'Opening Paystack…' : 'Subscribe to Team'}
      </button>
    </>
  );
}

describe('a checkout button after the browser restores the page', () => {
  it('is dead without the fix, which is the bug', () => {
    render(<Checkout withFix={false} />);
    const scout = screen.getByRole('button', { name: 'Subscribe to Scout' });

    fireEvent.click(scout);
    expect(screen.getByRole('button', { name: 'Opening Paystack…' })).toBeDisabled();

    bfcacheRestore();

    // Still stuck. This is what a buyer meets today after pressing Back.
    expect(screen.getByRole('button', { name: 'Opening Paystack…' })).toBeDisabled();
  });

  it('becomes clickable again with the fix, without navigating anywhere', () => {
    render(<Checkout withFix />);
    const scout = screen.getByRole('button', { name: 'Subscribe to Scout' });

    fireEvent.click(scout);
    expect(screen.getByRole('button', { name: 'Opening Paystack…' })).toBeDisabled();

    bfcacheRestore();

    const restored = screen.getByRole('button', { name: 'Subscribe to Scout' });
    expect(restored).toBeEnabled();
    // And it still works, rather than merely looking enabled.
    fireEvent.click(restored);
    expect(screen.getByRole('button', { name: 'Opening Paystack…' })).toBeDisabled();
  });

  it('frees the other buttons the flag was disabling too', () => {
    // The half of the report about "other buttons related to that
    // interaction". Team was never pressed and was dead anyway.
    render(<Checkout withFix />);

    fireEvent.click(screen.getByRole('button', { name: 'Subscribe to Scout' }));
    expect(screen.getByRole('button', { name: 'Subscribe to Team' })).toBeDisabled();

    bfcacheRestore();

    expect(screen.getByRole('button', { name: 'Subscribe to Team' })).toBeEnabled();
  });

  it('leaves an ordinary page load alone', () => {
    // `persisted` is false for a normal navigation, where the module re-runs
    // and the state is initial anyway. Resetting unconditionally would clear
    // a flag set legitimately in the same tick as a load event.
    render(<Checkout withFix />);
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe to Scout' }));

    ordinaryPageShow();

    expect(screen.getByRole('button', { name: 'Opening Paystack…' })).toBeDisabled();
  });

  it('stops listening once the component is gone', () => {
    // A listener left attached would call setState on an unmounted component
    // every time any page in the app was restored.
    const { unmount } = render(<Checkout withFix />);
    unmount();
    expect(() => bfcacheRestore()).not.toThrow();
  });
});
