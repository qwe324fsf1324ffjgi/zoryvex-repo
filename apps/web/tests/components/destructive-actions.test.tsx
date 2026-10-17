import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { Button } from '@/components/ui/Button';

/**
 * The control that ends something should not look like the control that
 * starts something.
 *
 * "Yes, delete everything" was styled `primary`, the same emerald as Save,
 * Subscribe and Next. So the button that permanently destroys an account was
 * the button a person has been trained all the way through this product to
 * press when they want to proceed, and the confirmation dialog was carrying
 * the whole weight of telling them otherwise.
 *
 * Colour is deliberately not doing this alone, because it cannot: roughly one
 * in twelve men cannot reliably separate these two hues. Every use of the
 * variant is worded to name the consequence, and the second test below is
 * what keeps that true.
 */

const DESTRUCTIVE_CONFIRMS = [
  'apps/web/app/candidate/(app)/account/page.tsx',
  'apps/web/app/candidate/(app)/profile/page.tsx',
  'apps/web/app/employer/(app)/billing/page.tsx',
  'apps/web/src/components/billing/RealBillingPage.tsx',
];

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..');

describe('the danger variant', () => {
  it('is filled in the error colour, not the accent', () => {
    render(<Button variant="danger">Delete</Button>);
    const className = screen.getByRole('button').className;

    expect(className).toContain('bg-error-700');
    expect(className).not.toContain('bg-accent-600');
  });

  /**
   * A tap with no visible response reads as a button that did not work, and
   * the honest reaction is to press it again. On the one control in the
   * product where pressing twice is worst, that has to be right.
   */
  it('darkens when pressed, not only when hovered', () => {
    render(<Button variant="danger">Delete</Button>);
    const className = screen.getByRole('button').className;

    expect(className).toContain('hover:bg-error-800');
    expect(className).toContain('active:bg-error-900');
  });

  it('keeps the same touch floor as every other button', () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole('button').className).toContain('min-h-11');
  });
});

/**
 * Asserted against the source rather than by rendering, because these four
 * confirmations sit behind dialogs inside pages with their own data loading,
 * and standing all that up would test the fixtures more than the rule. The
 * rule is simply that a file with a destructive confirmation must use the
 * variant, and that is visible in the source.
 */
describe('every destructive confirmation uses it', () => {
  for (const path of DESTRUCTIVE_CONFIRMS) {
    it(`${path} confirms destructively`, () => {
      const source = readFileSync(join(repoRoot, path), 'utf8');
      expect(source).toContain('variant="danger"');
    });
  }

  /**
   * Unlocking a contact spends an allowance and is irreversible, but it is a
   * purchase rather than a destruction and stays the accent colour. Recorded
   * so the distinction is a decision somebody made rather than a file that
   * was missed.
   */
  it('leaves contact unlock on the accent colour, because it buys rather than destroys', () => {
    const source = readFileSync(
      join(repoRoot, 'apps/web/src/components/employer/MatchCard.tsx'),
      'utf8',
    );
    expect(source).toContain('Yes, unlock');
    expect(source).not.toContain('variant="danger"');
  });
});
