import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Section({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    // py-8 on a phone, py-12 from `sm` up. Two stacked sections each carried
    // 48px top and bottom at every width, so 96px of nothing sat between them
    // on a 812px screen. That reads as the page having ended. Desktop has the
    // room for it and keeps it; a phone does not and never did.
    <div className={cn('mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12', className)} {...props}>
      {children}
    </div>
  );
}

/**
 * `break-words` on both lines is load-bearing, not cosmetic: this header
 * renders user-supplied text (a role title an employer typed, a candidate's
 * display name), and a single long unbroken token — a pasted URL, a long
 * compound word — otherwise pushes the whole page sideways. Measured before
 * the fix: a 200-character title blew the document out to 4038px against a
 * 634px viewport. `overflow-wrap: break-word` breaks only when a word would
 * otherwise overflow, so ordinary titles are untouched.
 *
 * It is also the only page title an app page should use.
 *
 * Every page gets the same title size because a reader learns where the
 * title is once and then stops looking for it. That was not true here: an
 * audit on 2026-09-03 found h1 rendered at text-lg, text-xl, text-2xl and
 * text-4xl across four pages, and one page used two different sizes in two
 * branches of itself, so the same screen announced itself differently
 * depending on how it had gone. 37 pages already used this component; the
 * outliers were hand-rolled.
 *
 * The one deliberate exception is the marketing home hero, which is larger
 * on purpose: it is the first thing a stranger sees and is doing a different
 * job from a page title. An exception that is written down is a decision;
 * an exception that is not is drift.
 */
/**
 * THE HEADING SCALE, as the code already uses it.
 *
 * Written down on 2026-09-03 after an audit went looking for inconsistency
 * and mostly found convention. Measured across the whole app, three tiers
 * exist and every one of the 36 section headings obeys them, with no file
 * mixing two:
 *
 *   h1  PageHeader, text-3xl sm:text-4xl   every page, one per page.
 *       The marketing home hero is larger on purpose and is the only
 *       exception.
 *
 *   h2  text-2xl font-bold                 section heading on a marketing
 *       page that sells: home, pricing, for-employers, for-talent,
 *       how-verification-works, trust-safety. Larger because those pages
 *       are scanned rather than worked through.
 *
 *   h2  text-xl font-bold                  section heading on an app page
 *       or a legal page. Tighter because those pages are dense and the
 *       reader is doing a task, not being persuaded.
 *
 *   h2  font-semibold                      a title INSIDE a Card, which is
 *       subordinate to whatever section contains it. 32 of these exist and
 *       all 32 are inside a Card.
 *
 * The sizes are not the fragile part. The convention was already perfect
 * and entirely unwritten, which is precisely how h1 drifted to four
 * different sizes on four pages: nothing recorded what the rule was, so
 * each new page guessed. This comment is the guard.
 */
export function PageHeader({ title, intro }: { title: string; intro?: string }) {
  return (
    <div className="mb-10">
      <h1 className="text-3xl font-bold break-words text-ink-950 sm:text-4xl">{title}</h1>
      {intro && <p className="mt-4 max-w-2xl break-words text-lg text-ink-700">{intro}</p>}
    </div>
  );
}
