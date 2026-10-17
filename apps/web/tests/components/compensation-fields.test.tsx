import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { draftFromRange, type CompensationDraft } from '@zoryvex/contracts';
import { CompensationFields } from '../../src/components/intent/CompensationFields';

/**
 * Clearing a published pay range.
 *
 * The field used to hold a `CompensationRange`, so it had no value for an
 * empty box and inferred one: an edit that produced no number was read as
 * an edit that mentioned no number, and the old figure was kept. Deleting
 * both figures and saving left the range exactly as it was, under a hint
 * that told the employer clearing them would take it down. Nothing failed,
 * nothing was logged, and the only way to see it was to read the stored
 * record afterwards.
 *
 * This drives the real field rather than the helper, because the helper
 * was never the part that was wrong.
 */

/** Renders with state, so a clear has somewhere to land, as on a real page. */
function Harness({
  initial,
  onDraft,
}: {
  initial: CompensationDraft;
  onDraft: (draft: CompensationDraft) => void;
}) {
  const [value, setValue] = useState<CompensationDraft>(initial);
  return (
    <CompensationFields
      idPrefix="pay"
      legend="What does this pay?"
      hint="Optional."
      value={value}
      onChange={(next: CompensationDraft) => {
        setValue(next);
        onDraft(next);
      }}
    />
  );
}

describe('CompensationFields', () => {
  it('shows a stored range in both boxes', () => {
    render(
      <Harness
        initial={draftFromRange({ minNGN: 700000, maxNGN: 1100000, period: 'year' })}
        onDraft={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/From \(NGN\)/)).toHaveValue('700000');
    expect(screen.getByLabelText(/To \(NGN\)/)).toHaveValue('1100000');
  });

  /** The defect itself: emptying both boxes must reach the parent as empty. */
  it('reports both ends empty once the employer clears them', async () => {
    const onDraft = vi.fn();
    render(
      <Harness
        initial={draftFromRange({ minNGN: 700000, maxNGN: 1100000, period: 'month' })}
        onDraft={onDraft}
      />,
    );

    await userEvent.clear(screen.getByLabelText(/From \(NGN\)/));
    await userEvent.clear(screen.getByLabelText(/To \(NGN\)/));

    const last = onDraft.mock.calls.at(-1)?.[0] as CompensationDraft;
    expect(last.minNGN).toBeUndefined();
    expect(last.maxNGN).toBeUndefined();
    expect(screen.getByLabelText(/From \(NGN\)/)).toHaveValue('');
    expect(screen.getByLabelText(/To \(NGN\)/)).toHaveValue('');
  });

  it('says nothing is claimed about pay when both boxes are empty', async () => {
    render(<Harness initial={draftFromRange(undefined)} onDraft={vi.fn()} />);
    expect(screen.getByText(/Leave both empty to say nothing about pay/)).toBeInTheDocument();
  });

  /** A figure in one box is a state to pass through, not one to save. */
  it('asks for the missing end rather than showing a range', async () => {
    render(<Harness initial={draftFromRange(undefined)} onDraft={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/From \(NGN\)/), '700000');
    expect(screen.getByText(/top of the pay range/)).toBeInTheDocument();
    expect(screen.queryByText(/Shown as:/)).not.toBeInTheDocument();
  });

  it('shows the range back once both ends are there', async () => {
    render(<Harness initial={draftFromRange(undefined)} onDraft={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/From \(NGN\)/), '700000');
    await userEvent.type(screen.getByLabelText(/To \(NGN\)/), '1100000');
    expect(screen.getByText(/NGN 700,000 to NGN 1,100,000 per month/)).toBeInTheDocument();
  });

  it('flags an inverted range instead of offering it as a range', async () => {
    render(<Harness initial={draftFromRange(undefined)} onDraft={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/From \(NGN\)/), '900000');
    await userEvent.type(screen.getByLabelText(/To \(NGN\)/), '400000');
    expect(
      screen.getByText('The top of the range cannot be below the bottom of it.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Shown as:/)).not.toBeInTheDocument();
  });
});
