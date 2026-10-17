import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Checkbox } from '@/components/ui/Checkbox';
import { RadioGroup } from '@/components/ui/RadioGroup';
import { Tabs } from '@/components/ui/Tabs';

/**
 * A floor on how small an interactive control is allowed to be.
 *
 * The complaint that started this was that pressing things produced no
 * visible response, which turned out to be a missing `:active` rule. Sitting
 * underneath it was a second problem with the same cause: the controls are
 * sized for a mouse. Buttons landed near 36px and text fields near 38px, and
 * checkboxes and radios were 16px boxes. Apple's guideline is 44 and
 * Material's is 48; WCAG 2.2's 24px floor is a legal minimum rather than a
 * usable one.
 *
 * These assert the utility class rather than a measured box, and that is a
 * real limitation worth stating: jsdom does no layout, so there is no height
 * to measure here. The class is the mechanism, so pinning it catches the
 * regression that matters (somebody removing the floor while editing the
 * variant list) even though it cannot catch a parent style overriding it.
 */

const TOUCH_FLOOR = 'min-h-11';
const BOX_SIZE = ['h-6', 'w-6'];

describe('controls keep a thumb-sized floor', () => {
  it('gives a button a minimum height', () => {
    render(<Button>Press me</Button>);
    expect(screen.getByRole('button').className).toContain(TOUCH_FLOOR);
  });

  it('gives a text field the same floor as a button', () => {
    render(<Input id="a" label="Email" />);
    expect(screen.getByLabelText('Email').className).toContain(TOUCH_FLOOR);
  });

  /**
   * A select and a text field in one form at different heights reads as a
   * mistake before it reads as a size, so they share the floor rather than
   * each having their own.
   */
  it('gives a select the same floor as a text field', () => {
    render(
      <Select id="b" label="Track">
        <option value="x">X</option>
      </Select>,
    );
    expect(screen.getByLabelText('Track').className).toContain(TOUCH_FLOOR);
  });

  it('draws a checkbox at 24px, WCAG 2.2 target-size floor, rather than 16', () => {
    render(<Checkbox id="c" label="I agree" />);
    const className = screen.getByLabelText('I agree').className;
    for (const size of BOX_SIZE) expect(className).toContain(size);
  });

  it('draws a radio at the same size as a checkbox', () => {
    render(
      <RadioGroup
        name="r"
        legend="Pick"
        value="one"
        onChange={() => {}}
        options={[{ value: 'one', label: 'One' }]}
      />,
    );
    const className = screen.getByLabelText('One').className;
    for (const size of BOX_SIZE) expect(className).toContain(size);
  });

  /**
   * The floor must not have been bought by removing the padding, which would
   * leave the control the same height and merely differently specified.
   */
  it('keeps the padding that was already there', () => {
    render(<Input id="d" label="Name" />);
    expect(screen.getByLabelText('Name').className).toContain('py-2');
  });
});

/**
 * Tabs is not rendered anywhere in the application today. That is exactly why
 * it is worth pinning: an unused component in a design system is a set of
 * defaults waiting for the first person who reaches for it, and this one had
 * two problems that would only have surfaced once somebody did.
 */
describe('the unused tab control does not lie in wait', () => {
  function renderTabs() {
    return render(
      <Tabs
        label="Sections"
        tabs={[
          { id: 'one', label: 'One', content: <p>First</p> },
          { id: 'two', label: 'Two', content: <p>Second</p> },
        ]}
      />,
    );
  }

  it('carries the same touch floor as every other control', () => {
    renderTabs();
    expect(screen.getByRole('tab', { name: 'One' }).className).toContain('min-h-11');
  });

  /**
   * globals.css restricts ink-500 to text on warm-50 and records that the
   * rule has already been broken twice. A Card is warm-100, so an unselected
   * tab inside one would have been the third.
   */
  it('uses a muted colour that survives a Card background', () => {
    renderTabs();
    const unselected = screen.getByRole('tab', { name: 'Two' }).className;

    expect(unselected).toContain('text-ink-700');
    expect(unselected).not.toContain('text-ink-500');
  });

  /** Keyboard support was already correct and is asserted so it stays that way. */
  it('moves selection with the arrow keys', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    renderTabs();

    const first = screen.getByRole('tab', { name: 'One' });
    first.focus();
    await userEvent.keyboard('{ArrowRight}');

    expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'One' })).toHaveAttribute('aria-selected', 'false');
  });
});
