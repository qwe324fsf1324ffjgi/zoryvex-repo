'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Evidence } from '@zoryvex/contracts';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ProofMark, proofMarkState } from '@/components/ui/ProofMark';
import { EVIDENCE_SOURCE_LABELS, VERIFICATION_METHOD_FOR_SOURCE } from '@zoryvex/contracts';
import { PageHeader, Section } from '@/components/layout/Section';
import { messageFor } from '@/lib/real-api/error-message';
import { Input } from '@/components/ui/Input';
import { getLocalAdapters } from '@zoryvex/local-adapters';
import { PageLoading } from '@/components/ui/PageLoading';
import {
  isRealApiConfigured,
  realEvidenceClaims,
  type RepoVerificationChallenge,
  type VerificationResult,
} from '@/lib/real-api';

/**
 * The two checks a claim can be eligible for.
 *
 * `graded_task` is gone from here. A graded task is a brief we publish, with
 * a rubric we publish, marked against a file somebody uploads - which a
 * language model solves from the brief alone, so the mark said nothing about
 * the person. It is no longer a route to verified, and no claim type maps to
 * it (packages/contracts VERIFICATION_METHOD_FOR_SOURCE).
 */
type Method = 'issuer_badge' | 'repo_ownership';

export default function VerifyEvidencePage() {
  return (
    <Suspense
      fallback={
        <Section className="max-w-2xl">
          <PageLoading blocks={2} />
        </Section>
      }
    >
      <VerifyEvidence />
    </Suspense>
  );
}

function VerifyEvidence() {
  const evidenceId = useSearchParams().get('id');
  const useReal = isRealApiConfigured();

  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  /**
   * Derived from the claim, not chosen here.
   *
   * This was a radio group asking "What kind of proof do you have?", with all
   * three options offered whatever the claim said it was about. So a claim
   * filed as a code repository could be checked as a certification, and the
   * stored evidence ended up saying one thing while the check behind it said
   * another. The server refuses that now, and asking a question whose only
   * acceptable answer is already known would just be a way of letting people
   * get it wrong.
   *
   * `null` means the claim has no outside source to check against. That is an
   * answer, and the page says it, rather than offering a check that would
   * fail.
   */
  const method: Method | null = evidence ? VERIFICATION_METHOD_FOR_SOURCE[evidence.source] : null;

  const [badgeUrl, setBadgeUrl] = useState('');
  const [gistUrl, setGistUrl] = useState('');
  const [repoUrl, setRepoUrl] = useState('');

  const [challenge, setChallenge] = useState<RepoVerificationChallenge | null>(null);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const outcome = useRef<HTMLDivElement>(null);

  // Only once an answer exists. Without the guard this fires on first render
  // and steals focus from the top of a page nobody has interacted with yet.
  useEffect(() => {
    if (result || error) outcome.current?.focus();
  }, [result, error]);

  useEffect(() => {
    if (!evidenceId) {
      setLoadState('failed');
      return;
    }
    let cancelled = false;

    async function load() {
      try {
        let item: Evidence | null;
        if (useReal) {
          const loaded = await realEvidenceClaims.getEvidence(evidenceId!);
          item = loaded.evidence;
        } else {
          const { auth, data } = getLocalAdapters();
          const candidateId = auth.getSession()?.candidateId ?? '';
          item = data.listCandidateEvidence(candidateId).find((e) => e.id === evidenceId) ?? null;
        }

        if (cancelled) return;
        if (!item) {
          setLoadState('failed');
          return;
        }
        setEvidence(item);
        setLoadState('ready');
      } catch {
        // A load failure is never shown as "not found": the distinction
        // matters to someone deciding whether to retry or go back.
        if (!cancelled) setLoadState('failed');
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [evidenceId, useReal]);

  async function getCode() {
    if (!evidenceId) return;
    setBusy(true);
    setError(null);
    try {
      setChallenge(await realEvidenceClaims.beginRepoVerification(evidenceId));
    } catch {
      setError('Could not get a verification code just now. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  async function runCheck() {
    if (!evidenceId) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      // Only the two checks a claim can actually be eligible for. The button
      // that reaches here is not rendered when the method is null.
      if (method === null) return;
      const proof =
        method === 'issuer_badge'
          ? ({ method, badgeUrl: badgeUrl.trim() } as const)
          : ({ method, gistUrl: gistUrl.trim(), repoUrl: repoUrl.trim() } as const);

      const outcome = await realEvidenceClaims.verifyEvidence(evidenceId, proof);
      setResult(outcome);
      if (outcome.verified && evidence) {
        setEvidence({ ...evidence, verificationState: 'verified' });
      }
    } catch (err) {
      // messageFor rather than err.message: the old form surfaced any
      // error's text, so a dropped connection showed the reader "Failed to
      // fetch" and a 5xx showed a server string. Only a 4xx the application
      // authored is worth showing, which is exactly what messageFor keeps.
      setError(
        messageFor(
          err,
          'Something went wrong running the check. Nothing about your evidence has changed.',
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  if (loadState === 'loading') {
    return (
      <Section className="max-w-2xl">
        <PageLoading blocks={2} label="Loading this evidence…" />
      </Section>
    );
  }

  if (loadState === 'failed') {
    // Two different situations shared one message. Arriving with no claim
    // named at all is not a failure to open something, it is a request that
    // never said what to open, and telling somebody their claim could not be
    // opened when they never named one sends them looking for a problem that
    // is not there.
    const nothingAsked = !evidenceId;
    return (
      <Section className="max-w-2xl">
        {/*
          The title sits above the card rather than inside it, at the same
          size as every other page in the app. It was text-lg here, smaller
          than the text-2xl used two branches down and less than half the
          PageHeader size the other 37 pages use, so the same page announced
          itself differently depending on which way it failed.
        */}
        <PageHeader
          title={nothingAsked ? 'Which claim should we check?' : 'We could not open that claim'}
          intro={
            nothingAsked
              ? 'This page checks one claim at a time, and this link did not name one. Open the claim you want checked from your profile and use its own button.'
              : 'It may have been deleted, or the link may be incomplete.'
          }
        />
        <ButtonLink href="/candidate/profile">
          {nothingAsked ? 'Pick a claim' : 'Back to your profile'}
        </ButtonLink>
      </Section>
    );
  }

  const alreadyVerified = evidence?.verificationState === 'verified';
  // A claim with no eligible check has nothing to submit, so the button that
  // would run one is never enabled.
  const canSubmit =
    method === 'issuer_badge'
      ? badgeUrl.trim().length > 0
      : method === 'repo_ownership'
        ? Boolean(gistUrl.trim() && repoUrl.trim())
        : false;

  /**
   * Why the button is off, in words, or null when it is on.
   *
   * It used to just go grey. A disabled control with no reason next to it is
   * indistinguishable from a broken one, and the honest reading of a button
   * that will not press is that the button is broken. This was reported as
   * exactly that: the check button "is not working", by somebody who had
   * done most of the steps and had no way to see which one was outstanding.
   */
  const blockedBecause: string | null = (() => {
    if (canSubmit) return null;
    if (method === 'issuer_badge') return 'Paste your badge link above and this turns on.';
    if (method !== 'repo_ownership') return null;
    const needsGist = !gistUrl.trim();
    const needsRepo = !repoUrl.trim();
    if (needsGist && needsRepo) return 'Add both links in step 2 and this turns on.';
    if (needsGist) return 'Add the link to your gist in step 2 and this turns on.';
    return 'Add the link to your repository in step 2 and this turns on.';
  })();

  /**
   * Separate from the reason above, and deliberately not a reason to disable
   * the button.
   *
   * A code issued on an earlier visit is still valid until it expires, and
   * this page has no way to know one exists: the nonce lives on the server
   * and is never read back. Blocking the check on a code this component
   * happens not to be holding would send somebody who is already finished
   * back to step 1 to issue a second one, which invalidates the gist they
   * already published and costs them the work twice over. So it warns, and
   * lets them press it.
   */
  const codeReminder =
    method === 'repo_ownership' && !challenge && canSubmit
      ? 'If you have not got a code yet, get one in step 1 first. The check needs it to prove the account is yours.'
      : null;

  return (
    <Section className="flex max-w-2xl flex-col gap-6">
      <PageHeader
        title="Get this claim checked"
        intro="A claim is something you say. A proof is one we confirmed against a source you do not control, and only proofs reach an employer. This is the step between the two."
      />

      <Card>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-700">
          The claim being checked
        </p>
        <p className="mt-1 break-words font-medium text-ink-950">{evidence?.claim}</p>
        <div className="mt-3">
          <ProofMark
            state={evidence ? proofMarkState(evidence) : 'unproved'}
            size="sm"
            checkedAt={evidence?.verifiedAt}
            lapsesAt={evidence?.verificationExpiresAt}
          />
        </div>
      </Card>

      {alreadyVerified ? (
        <>
          <Card>
            <h2 className="font-semibold text-ink-950">This one is already done</h2>
            <p className="mt-2 text-sm text-ink-700">
              It counts towards the roles you match. If you edit what this claim says, it will need
              checking again, because the check applies to the words as well as the proof behind
              them.
            </p>
            <ButtonLink href="/candidate/profile" className="mt-4">
              Back to your profile
            </ButtonLink>
          </Card>
        </>
      ) : (
        <>
          {method === null ? (
            <Card>
              <h2 className="font-semibold text-ink-950">
                There is nothing outside you to check this against
              </h2>
              <p className="mt-2 text-sm text-ink-700">
                You filed this as a {EVIDENCE_SOURCE_LABELS[evidence!.source]}. A certification can
                be confirmed with the body that issued it, and a public repository can be read on
                GitHub. Work described in your own words has no such source, and we are not going to
                pretend otherwise by stamping it checked.
              </p>
              <p className="mt-2 text-sm text-ink-700">
                If this claim really is about a certification or a public repository, edit it and
                say so, and the check will appear here. Otherwise it stays on your profile as
                something you have said, which is worth having and is not the same as a proof.
              </p>
            </Card>
          ) : null}

          {/*
            Nothing at all when there is no check to run.

            This was a two-way ternary written when `method` could only be one
            of two values, and it kept that shape after `method` became
            nullable. So a claim filed as a project write-up, which has no
            outside source and says so in the card above, then rendered "Step
            1: prove the account is yours" and "Step 2: point us at the work"
            underneath it. The page contradicted itself in consecutive cards
            and offered a GitHub flow for a claim that has no repository.
          */}
          {method === null ? null : method === 'issuer_badge' ? (
            <Card>
              <h2 className="font-semibold text-ink-950">Your certification badge</h2>
              <p className="mt-1 text-sm text-ink-700">
                AWS, Google Cloud, Kubernetes and HashiCorp all publish certifications on Credly.
                Open yours there, make sure it is public, and copy the link from your browser.
              </p>
              <div className="mt-4">
                <Input
                  id="badge-url"
                  label="Public badge link"
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  value={badgeUrl}
                  onChange={(event) => setBadgeUrl(event.target.value)}
                  placeholder="https://www.credly.com/badges/..."
                />
              </div>
              <p className="mt-2 text-sm text-ink-700">
                We confirm the badge was issued to the same email address as your Zoryvex account,
                so nobody can claim a certification that is not theirs.
              </p>
            </Card>
          ) : (
            <>
              <Card>
                <h2 className="font-semibold text-ink-950">Step 1: prove the account is yours</h2>
                {challenge ? (
                  <>
                    <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-sm text-ink-700">
                      {challenge.instructions.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ol>
                    <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-ink-700">
                      Your code
                    </p>
                    <code className="mt-1 block overflow-x-auto rounded-md bg-warm-200 px-3 py-2 font-mono text-sm text-ink-950">
                      {challenge.nonce}
                    </code>
                    <p className="mt-2 text-sm text-ink-700">
                      This code works once, and only for the next {challenge.expiresInMinutes}{' '}
                      minutes.
                    </p>
                    {/*
                      A link straight to the page the instructions describe.
                      Reading "go to gist.github.com" and then having to type
                      it into a phone keyboard is the step where people give
                      up, and the address is the one part of this they cannot
                      get wrong by guessing.
                    */}
                    <ButtonLink
                      href="https://gist.github.com/"
                      variant="secondary"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4"
                    >
                      Open GitHub gists in a new tab
                    </ButtonLink>
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-sm text-ink-700">
                      We give you a one-time code. You publish it in a public gist from the GitHub
                      account that owns the work, which is how we know the account is really yours.
                    </p>
                    {/*
                      Written for somebody who has never made a gist and is not
                      sure they are in the right place.

                      "Publish it in a public gist" is only an instruction if
                      you already know what a gist is. Three questions get
                      answered here in the order people actually ask them: what
                      is this thing, why does it prove anything, and what is it
                      going to cost me. The last one matters most: somebody who
                      thinks they are about to change their project will stop,
                      and they are not.
                    */}
                    <div className="mt-3 flex flex-col gap-2 text-sm text-ink-700">
                      <p>
                        <span className="font-medium text-ink-950">What a gist is.</span> A single
                        file you publish on GitHub, like a short note. It is not part of your
                        project and making one changes nothing in your code.
                      </p>
                      <p>
                        <span className="font-medium text-ink-950">Why it proves anything.</span>{' '}
                        Only the person signed in to your GitHub account can publish under your
                        name. So a note containing a code we just invented, appearing under your
                        account, could only have been put there by you. That is the whole trick.
                      </p>
                      <p>
                        <span className="font-medium text-ink-950">What it costs you.</span> About
                        two minutes, and nothing else. You can delete the gist as soon as this claim
                        is checked, and the check stays. We walk you through every step once you
                        have your code.
                      </p>
                      <p>
                        No GitHub account? Then this route is not for you, and that is fine. Verify
                        a certification instead.
                      </p>
                    </div>
                    <Button
                      className="mt-4"
                      disabled={busy || !useReal}
                      onClick={() => void getCode()}
                    >
                      {busy ? 'Getting your code…' : 'Get my code'}
                    </Button>
                  </>
                )}
              </Card>

              <Card>
                <h2 className="font-semibold text-ink-950">Step 2: point us at the work</h2>
                <div className="mt-4 flex flex-col gap-4">
                  <Input
                    id="gist-url"
                    label="Link to the gist with your code"
                    type="url"
                    inputMode="url"
                    autoComplete="off"
                    value={gistUrl}
                    onChange={(event) => setGistUrl(event.target.value)}
                    placeholder="https://gist.github.com/..."
                  />
                  <Input
                    id="repo-url"
                    label="Link to the repository"
                    type="url"
                    inputMode="url"
                    autoComplete="off"
                    value={repoUrl}
                    onChange={(event) => setRepoUrl(event.target.value)}
                    placeholder="https://github.com/you/your-project"
                  />
                </div>
                {/*
                  This said "We are checking work you started, not work you
                  copied", and that promised something the check cannot
                  deliver. `verifyRepository` reads GitHub's own `fork` flag,
                  which is set only when a repository was made with the Fork
                  button. Somebody who clones a project and pushes it as a new
                  repository produces `fork: false` and passes.

                  Saying so costs nothing and keeps the page honest. What the
                  check does establish is still worth having, and it is what
                  the sentence now claims: the account is provably theirs, and
                  GitHub credits them with commits in it.
                */}
                <p className="mt-2 text-sm text-ink-700">
                  The repository has to be public, and it cannot be a fork. We read GitHub&apos;s
                  own fork flag, so anything you forked is refused. A project somebody cloned and
                  pushed as a new repository is not marked by GitHub at all, so we do not claim to
                  catch that. What this proves is that the account is yours and that GitHub credits
                  you with commits in the repository.
                </p>
              </Card>
            </>
          )}

          {/*
            Suppressed for the same reason as the cards above. A claim with no
            eligible check had a "Run the check" button that could never
            become pressable, directly under a card explaining that there is
            nothing to check. A permanently dead control is not a disabled
            state, it is a promise the page cannot keep.
          */}
          {method === null ? null : useReal ? (
            <div>
              <Button
                disabled={busy || !canSubmit}
                aria-describedby={blockedBecause ? 'check-blocked' : undefined}
                onClick={() => void runCheck()}
              >
                {busy ? 'Checking…' : 'Run the check'}
              </Button>
              {blockedBecause ? (
                <p id="check-blocked" className="mt-2 text-sm text-ink-700">
                  {blockedBecause}
                </p>
              ) : null}
              {codeReminder ? <p className="mt-2 text-sm text-ink-700">{codeReminder}</p> : null}
            </div>
          ) : (
            <Card>
              <h2 className="font-semibold text-ink-950">Not available in this demo build</h2>
              <p className="mt-2 text-sm text-ink-700">
                Verification calls the certification issuer and GitHub directly, so it needs the
                real backend. Everything above is exactly what the live flow looks like; the check
                itself cannot run here, and pretending it passed would defeat the point.
              </p>
            </Card>
          )}

          {/*
            The answer is moved to, not just rendered.

            Both outcomes appear at the bottom of a page that is taller than a
            phone, below two cards of instructions, so pressing the button
            scrolled nothing and changed nothing the presser could see. On a
            phone that is the whole screen saying the button did nothing,
            which is the same complaint the disabled state produced and the
            same wrong conclusion: that the check is broken.

            Focus rather than a scroll, because it does both. It brings the
            result into view for somebody looking at it and moves the screen
            reader's cursor onto it for somebody who is not, and it leaves the
            keyboard in the right place to carry on from.
          */}
          <div ref={outcome} tabIndex={-1} className="outline-none">
            {error ? (
              <Card>
                <p className="text-sm text-error-700">{error}</p>
              </Card>
            ) : null}

            {result ? <Outcome result={result} /> : null}
          </div>
        </>
      )}
    </Section>
  );
}

/**
 * Three visually distinct outcomes, not two. "We could not check right now"
 * has to read differently from "this did not pass", or a candidate whose real
 * work hit an upstream rate limit is told their proof was rejected.
 */
function Outcome({ result }: { result: VerificationResult }) {
  if (result.verified) {
    return (
      <Card>
        <Badge tone="accent">Verified</Badge>
        <h2 className="mt-3 font-semibold text-ink-950">That checks out</h2>
        <p className="mt-1 text-sm text-ink-700">{result.detail}</p>
        <p className="mt-2 text-sm text-ink-700">
          This evidence now counts towards the roles you match.
        </p>
        <ButtonLink href="/candidate/profile" className="mt-4">
          Back to your profile
        </ButtonLink>
      </Card>
    );
  }

  if (result.retryable) {
    return (
      <Card>
        <Badge tone="neutral">Not checked yet</Badge>
        <h2 className="mt-3 font-semibold text-ink-950">We could not run the check</h2>
        <p className="mt-1 text-sm text-ink-700">{result.reason}</p>
        <p className="mt-2 text-sm text-ink-700">{result.whatToDo}</p>
      </Card>
    );
  }

  return (
    <Card>
      <Badge tone="error">Did not pass</Badge>
      <h2 className="mt-3 font-semibold text-ink-950">This did not verify</h2>
      <p className="mt-1 text-sm text-ink-700">{result.reason}</p>
      <p className="mt-2 text-sm text-ink-700">{result.whatToDo}</p>
    </Card>
  );
}
