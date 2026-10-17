/** Total ~5s of retrying before giving up — long enough to ride out a real hiccup, short enough not to feel stuck. */
export const DEFAULT_RETRY_DELAYS_MS = [500, 1500, 3000];

/**
 * Retries a real-API call a few times on failure before giving up, instead
 * of either failing instantly (a transient network blip shouldn't be
 * treated as a hard failure) or hanging forever (a genuine failure needs to
 * eventually resolve to *something* the UI can react to). Rethrows the
 * last error once every attempt is exhausted.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  delaysMs: readonly number[] = DEFAULT_RETRY_DELAYS_MS,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= delaysMs.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
    }
  }
}
