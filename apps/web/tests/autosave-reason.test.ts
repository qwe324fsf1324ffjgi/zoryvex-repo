import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useDebouncedAutosave } from '../src/lib/use-debounced-autosave';

/**
 * A refused save has to say what to fix.
 *
 * The autosave on the candidate profile refuses two things before they
 * reach the network: a contact detail that is not one, and a pay range
 * with a single end filled in. Both throw an Error carrying a sentence
 * written for the person reading it. The hook caught the rejection and
 * dropped the message, and the page had one line for every cause:
 * "Something went wrong saving your changes. Try again." Nothing had gone
 * wrong, and trying again would have failed the same way every time.
 */
describe('useDebouncedAutosave', () => {
  it('carries the reason a save was refused', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Add the top of the pay range.'));
    const { result, rerender } = renderHook(({ value }) => useDebouncedAutosave(value, onSave, 1), {
      initialProps: { value: 1 },
    });

    rerender({ value: 2 });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.reason).toBe('Add the top of the pay range.');
  });

  it('has no reason to offer when the failure carries no message', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('   '));
    const { result, rerender } = renderHook(({ value }) => useDebouncedAutosave(value, onSave, 1), {
      initialProps: { value: 1 },
    });

    rerender({ value: 2 });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.reason).toBeUndefined();
  });

  it('clears a previous reason once a save succeeds', async () => {
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(new Error('Add the top of the pay range.'))
      .mockResolvedValue(undefined);
    const { result, rerender } = renderHook(({ value }) => useDebouncedAutosave(value, onSave, 1), {
      initialProps: { value: 1 },
    });

    rerender({ value: 2 });
    await waitFor(() => expect(result.current.status).toBe('error'));

    rerender({ value: 3 });
    await waitFor(() => expect(result.current.status).toBe('saved'));
    expect(result.current.reason).toBeUndefined();
  });

  it('does not save on first render, so loading data never writes it back', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderHook(({ value }) => useDebouncedAutosave(value, onSave, 1), {
      initialProps: { value: 1 },
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(onSave).not.toHaveBeenCalled();
  });
});
