import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { ButtonLink } from '@/components/ui/Button';
import { Section } from '@/components/layout/Section';

/**
 * The end of the only page in this product a stranger reaches.
 *
 * A candidate's public proof page is the whole top of the candidate funnel
 * and it finished with a paragraph about what the page does not tell you and
 * a link to the verification method. Somebody who had just read a stranger's
 * checked work, understood the idea, and wanted one of their own had nowhere
 * to go. docs/COMMERCIAL_RUNBOOK.md requires every shared surface to carry
 * "one honest next action" and this one carried none.
 *
 * What this deliberately is not:
 *
 * It is not a referral ask. Nobody is invited to send this to their friends,
 * because the candidate whose page this is did not publish it to recruit for
 * us. They published it to show their work, and turning their page into a
 * marketing surface aimed at their contacts would be spending their
 * credibility on our growth without asking.
 *
 * It carries no counts, no "join N engineers", no testimonial and no
 * scarcity. There is no honest number to print: the marketplace gate has not
 * been met, and a figure invented to look established is the one thing a
 * product about checkable claims can never do.
 *
 * Both audiences are named because both actually arrive here. A candidate
 * sends this to people who hire and to people they worked with, and guessing
 * wrong at which one is reading produces a page that talks past them.
 */
export function PublicProofNextStep({ displayName }: { displayName: string }) {
  return (
    <Section>
      <Card>
        <h2 className="font-bold text-ink-950">What you just read</h2>
        <p className="mt-2 text-sm text-ink-700">
          Every proof on this page was checked by Zoryvex against a source {displayName} does not
          control: the body that issued a certification, or GitHub for work they published. We do
          not score anybody, rank anybody, or decide who gets hired. We check specific claims and
          say plainly what each check does and does not establish.
        </p>

        <div className="mt-6 flex flex-col gap-6 sm:flex-row">
          <div className="flex-1">
            <h3 className="font-semibold text-ink-950">If you have work of your own</h3>
            <p className="mt-1 text-sm text-ink-700">
              You can build a page like this one. Candidates pay nothing, you choose what goes on
              it, and you can take it down whenever you like. Nothing appears until a check has
              passed.
            </p>
            <ButtonLink href="/for-talent" className="mt-3">
              Make your own proof page
            </ButtonLink>
          </div>

          <div className="flex-1">
            <h3 className="font-semibold text-ink-950">If you are hiring</h3>
            <p className="mt-1 text-sm text-ink-700">
              Employers use Zoryvex to read checked evidence against a specific role, rather than
              taking a CV at its word. That side is paid, and the pricing is public.
            </p>
            <ButtonLink href="/for-employers" variant="secondary" className="mt-3">
              See how hiring works
            </ButtonLink>
          </div>
        </div>

        <p className="mt-6 text-sm text-ink-700">
          Want to know exactly what a check involves before you trust any of it? Read the{' '}
          <Link
            prefetch={false}
            href="/how-verification-works"
            className="text-accent-700 underline"
          >
            verification method
          </Link>
          .
        </p>
      </Card>
    </Section>
  );
}
