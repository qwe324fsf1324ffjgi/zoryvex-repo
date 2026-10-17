import { describe, expect, it, vi } from 'vitest';
import { retryWithBackoff } from '../src/lib/retry-with-backoff';

describe('retryWithBackoff', () => {
  it('returns the result on the first successful attempt without waiting', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await retryWithBackoff(fn, [1000, 1000]);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries after a failure and returns the eventual success', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok');
    const result = await retryWithBackoff(fn, [1]);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('rethrows the last error once every retry is exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('persistent failure'));
    await expect(retryWithBackoff(fn, [1, 1])).rejects.toThrow('persistent failure');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('never retries when given an empty delay list', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(retryWithBackoff(fn, [])).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
