import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The first field on the file-a-claim form decides whether the claim can ever
 * be checked, and it used to say nothing about that.
 *
 * Three of the five source types map to no verification method at all
 * (VERIFICATION_METHOD_FOR_SOURCE). A candidate could pick one, write four
 * careful paragraphs, save, open the verify page and be told for the first
 * time that there is nothing to check it against. Arriving that late, it
 * reads as a refusal of the work rather than as a property of the category
 * chosen on the first field. Worse, the default selection is the write-up,
 * which is one of the three.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));

const { default: NewEvidencePage } = await import('../../app/candidate/(app)/evidence/new/page');

describe('what the source type tells you about being checked', () => {
  it('warns on the default selection, which is one of the unverifiable ones', async () => {
    render(<NewEvidencePage />);

    expect(screen.getByText(/not checkable. Nothing outside you/i)).toBeTruthy();
  });

  it('says how a certification gets checked once that is chosen', async () => {
    render(<NewEvidencePage />);

    await userEvent.selectOptions(screen.getByLabelText(/source type/i), 'certification');

    expect(
      screen.getByText(/confirm the certification with the body that issued it/i),
    ).toBeTruthy();
    expect(screen.queryByText(/not checkable. Nothing outside you/i)).toBeNull();
  });

  it('says how a repository gets checked once that is chosen', async () => {
    render(<NewEvidencePage />);

    await userEvent.selectOptions(screen.getByLabelText(/source type/i), 'github');

    expect(screen.getByText(/prove the GitHub account is yours/i)).toBeTruthy();
  });

  /**
   * The unverifiable branch must not read as a rejection.
   *
   * It used to point at asking a colleague, which was removed on 2026-09-09.
   * A hint that names a route the product no longer has is worse than a
   * blunt one, so it now says what the claim is still good for and what
   * would actually get checked.
   */
  it('says what to do instead rather than only refusing', async () => {
    render(<NewEvidencePage />);

    expect(screen.getByText(/file it if it is useful to you/i)).toBeTruthy();
    expect(screen.queryByText(/ask somebody you worked with/i)).toBeNull();
  });

  /**
   * A hint is only useful if it is attached to the control. Screen-reader
   * users get this through aria-describedby or not at all.
   */
  it('ties the hint to the select rather than leaving it floating nearby', async () => {
    render(<NewEvidencePage />);

    const select = screen.getByLabelText(/source type/i);
    const describedBy = select.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!.split(' ')[0]!)?.textContent).toMatch(
      /not checkable. Nothing outside you/i,
    );
  });
});
