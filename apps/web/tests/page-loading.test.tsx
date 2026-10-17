import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageLoading, Skeleton } from '../src/components/ui/PageLoading';

/**
 * A skeleton is the easiest loading state to make worse than the text it
 * replaces.
 *
 * The failure is always the same: the bars are real elements, so a screen
 * reader walks a page of empty divs and hears nothing about waiting, while a
 * sighted reader gets a nice shimmer. Replacing the word "Loading…" with that
 * would be a downgrade wearing an upgrade's clothes.
 *
 * These pin the contract rather than the appearance. Widths and radii should
 * stay free to change; the announcement, the live region and the bars being
 * hidden should not.
 */

describe('PageLoading', () => {
  it('announces itself as a live region', () => {
    render(<PageLoading />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('still says the word a screen reader used to hear', () => {
    render(<PageLoading />);
    // The text the bare version showed, kept verbatim so nothing is lost in
    // the swap. Visually hidden, not absent.
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
  });

  it('lets a slower step say what it is waiting for', () => {
    render(<PageLoading label="Fetching this page’s proofs…" />);
    expect(screen.getByRole('status')).toHaveTextContent('Fetching this page’s proofs…');
  });

  it('hides the decorative bars from assistive technology', () => {
    const { container } = render(<PageLoading blocks={2} />);
    const bars = container.querySelectorAll('.bg-warm-200');
    expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars) {
      // Either the bar itself or an ancestor removes it from the tree. Both
      // are correct; what matters is that none of them is exposed.
      expect(bar.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it('draws a title bar by default and omits it on request', () => {
    // The page that already rendered its own PageHeader must not get a second
    // title drawn above the real one.
    const withHeader = render(<PageLoading blocks={0} />).container.querySelectorAll(
      '.bg-warm-200',
    );
    const withoutHeader = render(
      <PageLoading blocks={0} header={false} />,
    ).container.querySelectorAll('.bg-warm-200');
    expect(withHeader.length).toBeGreaterThan(withoutHeader.length);
    expect(withoutHeader.length).toBe(0);
  });

  it('draws the number of blocks it was asked for', () => {
    const one = render(<PageLoading blocks={1} header={false} />).container;
    const three = render(<PageLoading blocks={3} header={false} />).container;
    expect(three.querySelectorAll('.bg-warm-200').length).toBe(
      one.querySelectorAll('.bg-warm-200').length * 3,
    );
  });
});

describe('Skeleton', () => {
  it('is hidden from assistive technology on its own', () => {
    // Used inline, inside a caller's own live region. If it were exposed, a
    // section loading state would read as an empty element rather than as
    // nothing at all.
    const { container } = render(<Skeleton />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});
