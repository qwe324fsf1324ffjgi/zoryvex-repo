import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider, useToast } from '@/components/ui/Toast';

/**
 * Errors used to disappear on the same six-second timer as everything else.
 *
 * Several of them reach the reader only this way, with no inline copy behind
 * them. "Payment failed. No charge was completed." is one. Six seconds is not
 * long enough to read a sentence like that, work out what it means and act on
 * it, and somebody who looked away lost it with no way to ask what it said.
 * A message that cannot be extended or recalled is also the thing WCAG 2.2.1
 * exists to prevent.
 */

function Harness({ tone }: { tone: 'info' | 'success' | 'error' }) {
  const { showToast } = useToast();
  return (
    <button
      type="button"
      onClick={() => showToast('Payment failed. No charge was completed.', tone)}
    >
      Trigger
    </button>
  );
}

/** Reproduces the real collision: a Remove control whose toast says "removed". */
function RemoveHarness() {
  const { showToast } = useToast();
  return (
    <button type="button" onClick={() => showToast('Evidence item removed.', 'error')}>
      Remove
    </button>
  );
}

function renderHarness(tone: 'info' | 'success' | 'error') {
  return render(
    <ToastProvider>
      <Harness tone={tone} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a toast that reports a failure', () => {
  it('is still on screen long after a success would have gone', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderHarness('error');
    await user.click(screen.getByRole('button', { name: 'Trigger' }));

    expect(screen.getByText(/payment failed/i)).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByText(/payment failed/i)).toBeTruthy();
  });

  it('can be dismissed by the reader when they are done with it', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderHarness('error');
    await user.click(screen.getByRole('button', { name: 'Trigger' }));

    await user.click(screen.getByRole('button', { name: /dismiss/i }));

    expect(screen.queryByText(/payment failed/i)).toBeNull();
  });

  /**
   * The name is the action; the message is a description.
   *
   * The first version put the whole message in the aria-label, which reads
   * out as a button called "Dismiss: Payment failed. No charge was
   * completed." A name that is a sentence is not an action, and an
   * accessible name is also what every by-name query matches against: that
   * button started answering to "Remove" and broke a moderation test that
   * counts Remove buttons. Stacked toasts still get their context, through
   * aria-describedby, which is where a description belongs.
   */
  it('is named for what it does, not for the message it carries', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderHarness('error');
    await user.click(screen.getByRole('button', { name: 'Trigger' }));

    const control = screen.getByRole('button', { name: 'Dismiss notification' });
    const describedBy = control.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toMatch(/payment failed/i);
  });

  /**
   * The specific collision that got through, pinned. A toast whose text
   * contains a word another control uses must not make this button answer to
   * that word.
   */
  it('does not answer to a word that happens to be in the message', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ToastProvider>
        <RemoveHarness />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    // Exactly one Remove button: the real one. Not the toast's dismiss.
    expect(screen.getAllByRole('button', { name: /remove/i })).toHaveLength(1);
  });

  /**
   * The layer is fixed over the whole app and click-through on purpose, so a
   * toast cannot swallow a press meant for the submit button underneath it.
   * The dismiss control has to opt back in or it is decorative.
   */
  it('keeps the control clickable without making the layer catch clicks', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderHarness('error');
    await user.click(screen.getByRole('button', { name: 'Trigger' }));

    const control = screen.getByRole('button', { name: /dismiss/i });
    expect(control.className).toContain('pointer-events-auto');
    expect(control.parentElement?.parentElement?.className).toContain('pointer-events-none');
  });
});

describe('a toast that reports a success', () => {
  it('still clears itself, so the corner does not become a list', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderHarness('success');
    await user.click(screen.getByRole('button', { name: 'Trigger' }));

    expect(screen.getByText(/payment failed/i)).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(6_500);
    });

    expect(screen.queryByText(/payment failed/i)).toBeNull();
  });
});
