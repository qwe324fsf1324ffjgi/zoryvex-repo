'use client';

import { useEffect, useRef } from 'react';

/**
 * Clears state that only made sense while a full-page navigation was in
 * flight, when the browser brings that page back from the back/forward cache.
 *
 * The bug this exists for, found 2026-09-05 and live on test.zoryvex.space at
 * the time:
 *
 * Three buttons hand the browser to Paystack with `window.location`. Each sets
 * a pending flag first, so the button reads "Opening Paystack…" and cannot be
 * pressed twice while the redirect is in flight. Each clears that flag if the
 * request throws. None of them clears it on success, because on success the
 * page is leaving and there is nothing left to update.
 *
 * That reasoning is wrong about one thing: the page does not necessarily
 * leave for good. A buyer who opens Paystack, decides to think about it, and
 * presses Back is served the page out of the back/forward cache, which
 * restores the frozen JavaScript heap rather than re-running the module. The
 * flag is still set. The button is still disabled. On the billing page it is
 * worse than one button, because `disabled={startingPlan !== null}` sits
 * inside the loop over tiers, so every Subscribe button on the page is dead.
 *
 * Confirmed against the live response rather than assumed: the HTML is served
 * `Cache-Control: public, max-age=0, must-revalidate`, which permits the
 * back/forward cache (only `no-store` would disable it), and the app
 * registers no `unload` handler, which is the other common disqualifier.
 *
 * Why this and not the obvious alternatives:
 *
 * A `finally` that cleared the flag immediately would re-enable the button
 * while the redirect was still in flight, which is the double-charge shape
 * the flag was added to prevent. Keeping it disabled during the navigation is
 * deliberate and is kept.
 *
 * A timeout would be a guess about how long a redirect takes, and would fire
 * on a slow connection while the navigation was still perfectly healthy.
 *
 * `pageshow` with `persisted` is the event the browser fires for exactly this
 * situation and nothing else. On an ordinary fresh load `persisted` is false
 * and the module re-runs anyway, so there is nothing to clear.
 */
export function useResetOnRestore(reset: () => void): void {
  // The callback is read through a ref so the listener is attached once for
  // the life of the component. Depending on `reset` directly would tear down
  // and re-add the listener on every render, since callers pass an inline
  // arrow, and a listener that is absent for an instant is a listener that
  // can miss the event it exists for.
  const latest = useRef(reset);
  latest.current = reset;

  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) latest.current();
    }

    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);
}
