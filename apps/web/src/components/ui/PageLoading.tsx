import { cn } from '@/lib/cn';
import { Card } from './Card';

/**
 * The loading state for a page that is fetching what it exists to show.
 *
 * `StatusState` already covers eight non-happy-path states — empty, 403,
 * 404, 409, 422, 429, 500, offline — each with written copy. Loading was the
 * one it did not cover, and it is the one every reader meets most often: an
 * audit on 2026-09-05 found fourteen page-level loading states rendering the
 * bare word "Loading…" on an otherwise empty page. Every authenticated page
 * in the product opened that way, every time.
 *
 * Two things this fixes beyond looking finished.
 *
 * It stops the page jumping. The bars are laid out on the same geometry as
 * `PageHeader` and `Card`, so the reader's eye is already in the right place
 * when the real content replaces them, instead of the title arriving and
 * shoving everything down.
 *
 * It says which page is loading. A blank screen with "Loading…" is the same
 * screen everywhere, so a slow connection makes the whole app look like one
 * indistinguishable wait. A shape that resembles the page underneath tells
 * somebody they are in the right place.
 *
 * Accessibility, which is the part a skeleton usually gets wrong. The bars
 * are decorative and are hidden from assistive technology; the announcement
 * is a visually hidden string inside the live region, so a screen reader
 * hears "Loading…" exactly as it did before rather than nothing at all, or a
 * stream of empty divs. This mirrors the fix already made in RoleGuard,
 * where a live region placed on the wrong element replaced the `main`
 * landmark.
 *
 * Motion is Tailwind's `animate-pulse`, which needs no dependency and whose
 * keyframes end at full opacity. That matters because `globals.css` collapses
 * every animation to 0.01ms under `prefers-reduced-motion`, so the pulse
 * settles on the visible frame rather than vanishing.
 */

/**
 * One placeholder bar.
 *
 * Exported because loading happens at two granularities in this app and only
 * one of them is a whole page. A section inside a page that already has its
 * header and its other content needs bars without a title above them, and
 * reaching for `PageLoading` there would draw a second page inside the first.
 *
 * Decorative by default: whatever renders these owns the live region and the
 * announcement, so the bars stay out of the accessibility tree. A caller that
 * places them outside a live region is responsible for saying so some other
 * way.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('h-4 rounded bg-warm-200', className)} />;
}

/** Local alias, so the composition below reads as layout rather than plumbing. */
const Bar = Skeleton;

export interface PageLoadingProps {
  /**
   * Roughly how much content sits under the title, so the skeleton is about
   * the height of the page it stands in for. Deliberately coarse: matching a
   * page exactly would make this a second copy of that page's layout, which
   * would then drift from it.
   */
  blocks?: number;
  /** Whether the page this replaces has an intro line under its title. */
  intro?: boolean;
  /**
   * Whether to draw a title bar. Off for a page that already renders its
   * real PageHeader while its data loads: billing does, and drawing a
   * placeholder above a heading that is already there would be a second
   * title rather than a stand-in for the missing one.
   */
  header?: boolean;
  /** What a screen reader hears. Overridable so a slow step can say so. */
  label?: string;
  className?: string;
}

export function PageLoading({
  blocks = 2,
  intro = false,
  header = true,
  label = 'Loading…',
  className,
}: PageLoadingProps) {
  return (
    <div role="status" aria-live="polite" className={cn('animate-pulse', className)}>
      <span className="sr-only">{label}</span>

      <div aria-hidden="true">
        {/* Same rhythm as PageHeader: title, optional intro, mb-10. */}
        {header && (
          <div className="mb-10">
            <Bar className="h-9 w-2/3 max-w-md sm:h-10" />
            {intro && <Bar className="mt-4 h-5 w-full max-w-2xl" />}
          </div>
        )}

        <div className="flex flex-col gap-6">
          {Array.from({ length: blocks }, (_, i) => (
            // The real Card rather than a copy of its classes. Copying them
            // would put the skeleton's geometry on a second definition that
            // drifts the first time Card's padding changes, and the entire
            // value of this component is that it occupies the same space as
            // what replaces it.
            <Card key={i}>
              <Bar className="w-1/3" />
              <Bar className="mt-3 h-3 w-full" />
              <Bar className="mt-2 h-3 w-5/6" />
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
