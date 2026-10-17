'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';

/**
 * The candidate's control over their public proof page, and the snippet that
 * makes the mark carryable.
 *
 * Two things this deliberately does not do.
 *
 * It does not sell the feature. No "boost your visibility", no count of who
 * viewed it, no nudge to turn it on. Publishing your own verification record
 * is a decision with consequences a person should make coldly, and a control
 * that argues for one answer is not a consent control.
 *
 * It does not soften what revoking means, in either direction. Turning it off
 * destroys the link rather than hiding the page, so anything already shared
 * stops working — which is the point, and is exactly the sort of thing people
 * discover afterwards if nobody says it first.
 */
export interface PublicProofPanelProps {
  publicProofId: string | undefined;
  pageUrl: (publicProofId: string) => string;
  badgeUrl: (publicProofId: string) => string;
  onChange: (enabled: boolean) => Promise<void>;
  busy?: boolean;
}

export function PublicProofPanel({
  publicProofId,
  pageUrl,
  badgeUrl,
  onChange,
  busy = false,
}: PublicProofPanelProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const enabled = Boolean(publicProofId);

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard access can be refused, and a button that silently does
      // nothing is worse than one that admits it. The text stays selectable
      // either way, which is the fallback.
      setCopied('failed');
    }
  }

  const markdown = publicProofId
    ? `[![Zoryvex proofs](${badgeUrl(publicProofId)})](${pageUrl(publicProofId)})`
    : '';
  const html = publicProofId
    ? `<a href="${pageUrl(publicProofId)}"><img src="${badgeUrl(publicProofId)}" alt="Zoryvex proofs" /></a>`
    : '';

  return (
    <Card>
      <h2 className="font-bold text-ink-950">A page you can point people at</h2>
      <p className="mt-2 text-sm text-ink-700">
        A page anybody can open, showing only what has been checked and when it stops counting.
        Nothing else: not your email, not your claims that are still unchecked, not anything you
        have marked private.
      </p>

      <div className="mt-4">
        <Checkbox
          id="public-proof-consent"
          label="Publish a public proof page"
          checked={enabled}
          disabled={busy}
          onChange={(e) => void onChange(e.target.checked)}
        />
      </div>

      {enabled && publicProofId ? (
        <div className="mt-5 flex flex-col gap-4">
          <div>
            <p className="text-sm font-semibold text-ink-950">Your page</p>
            <p className="mt-1 break-all font-mono text-xs text-ink-700">
              {pageUrl(publicProofId)}
            </p>
            <div className="mt-2">
              <Button variant="secondary" onClick={() => void copy('link', pageUrl(publicProofId))}>
                Copy link
              </Button>
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-ink-950">The mark, for a README</p>
            <pre className="mt-1 overflow-x-auto rounded-md border border-warm-200 bg-warm-100 p-3 font-mono text-xs text-ink-900">
              {markdown}
            </pre>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void copy('markdown', markdown)}>
                Copy Markdown
              </Button>
              <Button variant="secondary" onClick={() => void copy('html', html)}>
                Copy HTML
              </Button>
            </div>
          </div>

          <p aria-live="polite" className="text-sm text-ink-700">
            {copied === 'failed'
              ? 'Your browser would not let us use the clipboard. Select the text and copy it.'
              : copied
                ? `Copied the ${copied}.`
                : ''}
          </p>

          <p className="text-sm text-ink-700">
            The mark shows how many proofs you have and the date of the most recent check. It is
            drawn fresh every time somebody loads it, so it goes out of date on its own rather than
            claiming something that stopped being true.
          </p>

          <p className="text-sm text-ink-700">
            Turning this off destroys the link. Anything you have already shared stops working, and
            switching it back on gives you a different address rather than the old one.
          </p>
        </div>
      ) : (
        <p className="mt-4 text-sm text-ink-700">
          Off. Nothing about you is readable without an account.
        </p>
      )}
    </Card>
  );
}
