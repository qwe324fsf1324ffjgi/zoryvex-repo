'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { PublicProof } from '@zoryvex/contracts';
import { EVIDENCE_STRENGTH_DEFINITIONS, LAUNCH_TRACK_LABELS } from '@zoryvex/contracts';
import { Card } from '@/components/ui/Card';
import { StatusState } from '@/components/ui/StatusState';
import { PageHeader, Section } from '@/components/layout/Section';
import { isRealApiConfigured, realPublicProof } from '@/lib/real-api';
import { PageLoading } from '@/components/ui/PageLoading';
import { PublicProofNextStep } from '@/components/marketing/PublicProofNextStep';

/**
 * A candidate's public proof page: the only page in this product a stranger
 * can read, and the only one that has to earn its credibility from scratch.
 *
 * It is written on the assumption that the reader arrived from somewhere
 * else, has no account, has never heard of Zoryvex, and has every reason to
 * assume a page like this is marketing. So it does the opposite of asserting
 * trust: it names what was checked, who it was checked with, when, and when
 * it stops being true, and it says plainly what it does not know.
 *
 * The query parameter rather than a path segment is the static export's
 * doing: pages are generated at build time and a per-candidate route cannot
 * be. A nicer URL would need a CloudFront rewrite and is worth doing later;
 * shipping a working link beats holding one back for its shape.
 */
function PublicProofContent() {
  const params = useSearchParams();
  const id = params.get('id');
  const useReal = isRealApiConfigured();

  const [page, setPage] = useState<PublicProof | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');

  const load = useCallback(async () => {
    if (!id) {
      setState('missing');
      return;
    }
    if (!useReal) {
      setState('error');
      return;
    }
    try {
      setPage(await realPublicProof.getPublicProof(id));
      setState('ready');
    } catch {
      // Deliberately not distinguishing a 404 from a withdrawn page. The
      // server refuses both identically so the URL cannot be used to ask
      // questions about people, and repeating that distinction here would
      // undo it.
      setState('missing');
    }
  }, [id, useReal]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'loading') {
    return (
      <Section>
        <PageLoading blocks={2} label="Fetching this page’s proofs…" />
      </Section>
    );
  }

  if (state === 'missing') {
    return (
      <Section>
        <StatusState
          kind="404"
          title="There is no page here"
          body="This link may never have existed, or the person it belonged to has taken it down. Either way there is nothing to show, and we will not say which."
        />
      </Section>
    );
  }

  if (state === 'error' || !page) {
    // Reachable only in a build with no API behind it: a real failure to
    // fetch is caught above and deliberately answers "missing", so this
    // branch is the local demo and nothing else.
    //
    // It used to say "Something went wrong. Try again in a moment.", which
    // is the mistake already corrected once at Kit checkout: it named a
    // cause that was not the cause, and offered a retry that can never
    // succeed, because there is no server to retry against and never will
    // be in this build. Somebody would keep pressing reload.
    return (
      <Section>
        <StatusState
          kind="empty"
          title="Proof pages need the live service"
          body="This is the local demo build, which has no backend to read a proof page from. On the real site this link would open the candidate's verified proofs, or say plainly that there is nothing here."
        />
      </Section>
    );
  }

  const unsupportedLevels = page.proofs[0]?.strength.unsupported ?? [];

  return (
    <>
      <PageHeader
        title={page.displayName}
        intro={`${LAUNCH_TRACK_LABELS[page.launchTrack]} · ${proofCount(page.proofs.length)}`}
      />

      <Section>
        {page.proofs.length === 0 ? (
          <Card>
            <h2 className="font-bold text-ink-950">Nothing checked yet</h2>
            <p className="mt-2 text-ink-700">
              This person has a page but no proofs on it. That is not a judgement about them. It
              means Zoryvex has checked nothing here, so there is nothing here worth taking our word
              for.
            </p>
          </Card>
        ) : (
          <ul className="flex flex-col gap-4">
            {page.proofs.map((proof) => (
              <li key={`${proof.verifiedAt}-${proof.claim}`}>
                <Card>
                  <h2 className="font-bold text-ink-950">{proof.claim}</h2>
                  <dl className="mt-3 flex flex-col gap-2 text-sm">
                    <div>
                      <dt className="font-semibold text-ink-950">What was checked</dt>
                      <dd className="text-ink-700">{proof.verificationDetail}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-ink-950">Checked</dt>
                      <dd className="text-ink-700">
                        {formatDate(proof.verifiedAt)}
                        {proof.verificationExpiresAt
                          ? `, and stops counting on ${formatDate(proof.verificationExpiresAt)}`
                          : '. The credential behind it does not lapse.'}
                      </dd>
                    </div>
                    {/*
                      What this establishes, level by level, with the reason
                      for each. "Verified" on its own asks a stranger to take
                      a word for it, which is the thing this page refuses to
                      do.
                    */}
                    <div>
                      <dt className="font-semibold text-ink-950">What that establishes</dt>
                      <dd>
                        <ul className="mt-1 flex flex-col gap-1 text-ink-700">
                          {proof.strength.attained.map((level) => (
                            <li key={level}>
                              <span className="font-medium text-ink-950">
                                {EVIDENCE_STRENGTH_DEFINITIONS[level].name}
                              </span>{' '}
                              · {proof.strength.basis[level]}
                            </li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                  </dl>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/*
        The honest half, and the reason this page is worth reading at all. A
        page that listed only what it knows would be indistinguishable from
        every other profile on the internet. Saying what it does not know is
        the thing a CV cannot do.
      */}
      <Section>
        <Card className="border-warm-300 bg-warm-100">
          <h2 className="font-bold text-ink-950">What this page does not tell you</h2>
          <ul className="mt-2 flex flex-col gap-2 text-sm text-ink-700">
            <li>
              Anything this person has not submitted to be checked. They may have done a great deal
              more than appears here.
            </li>
            <li>
              Whether they are any good to work with, how they behave under pressure, or whether
              they would suit your team. None of that is checkable, so none of it is claimed.
            </li>
            <li>
              How they came by any of it. Each entry says what was confirmed and with whom, and
              nothing beyond that.
            </li>
            {unsupportedLevels.map((level) => (
              <li key={level}>
                <span className="font-medium text-ink-950">
                  {EVIDENCE_STRENGTH_DEFINITIONS[level].name}.
                </span>{' '}
                {EVIDENCE_STRENGTH_DEFINITIONS[level].whyNot}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-ink-700">
            Built {formatDateTime(page.generatedAt)}. Every proof above was re-checked against its
            expiry at that moment. Read the{' '}
            <Link prefetch={false} href="/how-verification-works">
              verification method
            </Link>{' '}
            if you want to know exactly what a check involves.
          </p>
        </Card>
      </Section>

      <PublicProofNextStep displayName={page.displayName} />
    </>
  );
}

function proofCount(count: number): string {
  if (count === 0) return 'no proofs yet';
  return count === 1 ? '1 proof' : `${count} proofs`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'an unreadable date';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'at an unreadable time';
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * The Suspense boundary is required rather than stylistic: `useSearchParams`
 * suspends, and a static export with no boundary fails the build rather than
 * degrading. Learned from `candidate/evidence/edit`, which does the same.
 */
export default function PublicProofPage() {
  return (
    <Suspense fallback={null}>
      <PublicProofContent />
    </Suspense>
  );
}
