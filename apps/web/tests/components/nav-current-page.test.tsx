import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * Where am I.
 *
 * SiteNav marks the current page and the three navs behind sign-in did not.
 * Those are the ones people see constantly: a candidate moving between
 * Profile, Preview and Account got three identical links and no answer to
 * the first question any navigation is supposed to answer.
 *
 * The marking is aria-current first and appearance second, and the
 * appearance is an underline with a darker ink rather than colour alone,
 * matching what SiteNav already does.
 */

const pathname = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => pathname(),
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock('@/lib/real-api', () => ({
  isRealApiConfigured: () => false,
  realAuth: { signOut: vi.fn() },
}));

const { CandidateNav } = await import('@/components/candidate/CandidateNav');
const { EmployerNav } = await import('@/components/employer/EmployerNav');
const { AdminNav } = await import('@/components/admin/AdminNav');

describe.each([
  ['candidate', CandidateNav, '/candidate/account', 'Account', 'Profile'],
  ['employer', EmployerNav, '/employer/billing', 'Billing', 'Roles'],
  ['admin', AdminNav, '/admin/billing', 'Billing diagnostic', 'Exception queue (real backend)'],
] as const)('the %s nav', (_name, Nav, here, currentLabel, otherLabel) => {
  /**
   * Each nav renders its links twice since the mobile menus were added: once
   * in the bar that shows from `md` up, once inside the `<details>` that
   * replaces it below that. Only one is ever visible to a person, but jsdom
   * applies no stylesheet, so both are in the tree here and a `getByRole`
   * for a link now matches two elements.
   *
   * Asserting across every copy rather than picking one is the stronger
   * claim: a reader who opens the phone menu is owed the same "you are here"
   * as a reader on a laptop, and marking only the bar would leave the menu
   * silent.
   */
  const allLinks = (name: string) => screen.getAllByRole('link', { name });

  it('marks the page you are on, in every copy of the nav', () => {
    pathname.mockReturnValue(here);
    render(<Nav />);

    const links = allLinks(currentLabel);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).toHaveAttribute('aria-current', 'page');
  });

  it('leaves every other link unmarked', () => {
    pathname.mockReturnValue(here);
    render(<Nav />);

    for (const link of allLinks(otherLabel)) expect(link).not.toHaveAttribute('aria-current');
  });

  /**
   * Colour alone would not do. A slightly darker ink among inks is not a
   * distinction a reader can rely on, so the current link is marked visually
   * too: underlined in the wide bar, and filled in the phone menu, which is
   * the same pair of treatments SiteNav already uses.
   */
  it('shows it as well as announcing it, in both treatments', () => {
    pathname.mockReturnValue(here);
    render(<Nav />);

    const marked = allLinks(currentLabel).map((link) => link.className);
    expect(marked.some((c) => c.includes('underline'))).toBe(true);
    expect(marked.every((c) => c.includes('underline') || c.includes('bg-warm-100'))).toBe(true);
  });

  it('marks nothing when you are somewhere else entirely', () => {
    pathname.mockReturnValue('/somewhere/else');
    render(<Nav />);

    for (const link of allLinks(currentLabel)) expect(link).not.toHaveAttribute('aria-current');
    for (const link of allLinks(otherLabel)) expect(link).not.toHaveAttribute('aria-current');
  });

  /**
   * The menu is the only way to reach these links on a phone, so its absence
   * would strand a signed-in person on whatever page they landed on.
   */
  it('offers a menu for the widths the bar is hidden at', () => {
    pathname.mockReturnValue(here);
    const { container } = render(<Nav />);

    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details!.querySelector('summary')?.textContent).toBe('Menu');
  });

  /**
   * The landmark has to wrap the menu, not sit inside it.
   *
   * With the `<nav>` inside the `<details>`, the only navigation on the page
   * below `md` was collapsed content, which is outside the accessibility
   * tree until the menu is opened. A phone then had no navigation landmark
   * at all, and three Playwright specs failed on a missing one before this
   * was noticed. Asserting the nesting here catches it in a second rather
   * than in a sixteen-minute browser run.
   */
  it('keeps a navigation landmark exposed at both widths', () => {
    pathname.mockReturnValue(here);
    const { container } = render(<Nav />);

    const navs = Array.from(container.querySelectorAll('nav'));
    expect(navs).toHaveLength(2);

    const wide = navs.find((n) => n.className.includes('hidden md:block'));
    const narrow = navs.find((n) => n.className.includes('md:hidden'));
    expect(wide, 'one nav shows from md up').toBeTruthy();
    expect(narrow, 'the other shows below md').toBeTruthy();

    // The menu lives inside the narrow landmark, never the other way round.
    expect(narrow!.querySelector('details')).not.toBeNull();
    expect(container.querySelector('details nav')).toBeNull();
  });
});
