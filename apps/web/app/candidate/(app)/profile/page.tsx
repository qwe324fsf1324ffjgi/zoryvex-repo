'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getLocalAdapters } from '@zoryvex/local-adapters';
import {
  EVIDENCE_VISIBILITY_LABELS,
  LAUNCH_TRACK_LABELS,
  LinkedInUrlSchema,
  ProfileLinkSchema,
  PhoneSchema,
  type Candidate,
  compensationFromDraft,
  draftFromRange,
  type CompensationDraft,
  type EngagementKind,
  type Evidence,
  TEXT_LIMITS,
} from '@zoryvex/contracts';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { countriesByName, suggestedUtcOffsetMinutes, utcOffsetOptions } from '@/lib/countries';
import { Textarea } from '@/components/ui/Textarea';
import { PageHeader, Section } from '@/components/layout/Section';
import { ProofMark, proofMarkState } from '@/components/ui/ProofMark';
import { ThresholdPanel } from '@/components/candidate/ThresholdPanel';
import { PublicProofPanel } from '@/components/candidate/PublicProofPanel';
import { StatusState } from '@/components/ui/StatusState';
import { useDebouncedAutosave } from '@/lib/use-debounced-autosave';
import { CompensationFields } from '@/components/intent/CompensationFields';
import { OpenToFields } from '@/components/intent/EngagementKindFields';
import { useSession } from '@/lib/use-session';
import { useToast } from '@/components/ui/Toast';
import { retryWithBackoff } from '@/lib/retry-with-backoff';
import { PageLoading } from '@/components/ui/PageLoading';
import {
  isRealApiConfigured,
  messageFor,
  realCandidateProfile,
  realEvidenceClaims,
  realPrivacy,
  realPublicProof,
} from '@/lib/real-api';

/** The site's own origin, for a link a candidate copies out of the product. */
function siteOrigin(): string {
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

function apiOrigin(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
}

/**
 * What is wrong with a contact field, in the words the candidate needs.
 *
 * Empty is always fine: both channels are optional, and a candidate who
 * gives neither is not ranked below one who gives both. Anything else is
 * checked against the same schema the server validates with, so the form
 * cannot accept a value the API would refuse.
 */
type ContactChannel = 'phone' | 'linkedin' | 'website';

const CONTACT_SCHEMAS = {
  phone: PhoneSchema,
  linkedin: LinkedInUrlSchema,
  website: ProfileLinkSchema,
} as const;

function contactError(value: string, channel: ContactChannel = 'phone'): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const schema = CONTACT_SCHEMAS[channel];
  const result = schema.safeParse(trimmed);
  return result.success ? null : (result.error.issues[0]?.message ?? 'That does not look right.');
}

export default function ProfilePage() {
  const session = useSession();
  const router = useRouter();
  const { showToast } = useToast();
  const useReal = isRealApiConfigured();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  // Counts live proofs, not the stored flag. An item verified in 2026
  // against a credential that expired in 2027 stays stored as `verified`,
  // and the server stops counting it the day it lapses. Saying "3 of 4
  // proved" about proofs the marketplace had already dropped would be the
  // product telling its own user something it does not believe.
  const liveProofCount = evidence.filter((e) => proofMarkState(e) === 'proved').length;
  const [displayName, setDisplayName] = useState('');
  const [summary, setSummary] = useState('');
  // Empty string means "not stated", which is a real answer rather than a
  // missing one: an unstated location is never filtered against, so leaving
  // this blank costs a candidate no visibility at all.
  const [country, setCountry] = useState('');
  const [phone, setPhone] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [utcOffsetMinutes, setUtcOffsetMinutes] = useState<number>(suggestedUtcOffsetMinutes());
  // What this person is open to and what they need to be paid. Both
  // optional: an unstated preference is read by matching as no constraint
  // rather than as a refusal, which is what makes stating one safe.
  const [openTo, setOpenTo] = useState<EngagementKind[]>([]);
  const [payDraft, setPayDraft] = useState<CompensationDraft>(() => draftFromRange(undefined));
  const [loadFailed, setLoadFailed] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  /*
    Both consent checkboxes are network round trips in real mode, and
    `checked` is bound to the fetched profile, so neither can move until the
    request comes back. Without this flag that reads as a checkbox which does
    nothing when clicked, and a second click in the gap sends a request built
    from the value the first one was already changing.

    One flag for both rather than one each: the second consent's own hint
    text depends on the first's value, so letting them run at once would let
    a candidate act on a label that is mid-change.
  */
  const [consentBusy, setConsentBusy] = useState(false);

  const refresh = useCallback(() => {
    if (!session?.candidateId) return;

    if (useReal) {
      setLoadFailed(false);
      retryWithBackoff(() =>
        Promise.all([realCandidateProfile.getProfile(), realEvidenceClaims.listEvidence()]),
      )
        .then(([{ candidate: found, version: v }, evidenceList]) => {
          setCandidate(found);
          setVersion(v);
          setEvidence(evidenceList);
          setDisplayName(found.displayName);
          setSummary(found.summary);
          setOpenTo(found.intent?.openTo ?? []);
          setPayDraft(draftFromRange(found.intent?.minimumCompensation));
          setPhone(found.phone ?? '');
          setLinkedinUrl(found.linkedinUrl ?? '');
          setWebsiteUrl(found.websiteUrl ?? '');
          setCountry(found.location?.country ?? '');
          if (found.location) setUtcOffsetMinutes(found.location.utcOffsetMinutes);
        })
        .catch(() => setLoadFailed(true));
      return;
    }

    const { data } = getLocalAdapters();
    const found = data.getCandidate(session.candidateId);
    setCandidate(found);
    setEvidence(data.listCandidateEvidence(session.candidateId));
    if (found) {
      setDisplayName(found.displayName);
      setSummary(found.summary);
      setOpenTo(found.intent?.openTo ?? []);
      setPayDraft(draftFromRange(found.intent?.minimumCompensation));
      setPhone(found.phone ?? '');
      setLinkedinUrl(found.linkedinUrl ?? '');
      setWebsiteUrl(found.websiteUrl ?? '');
      setCountry(found.location?.country ?? '');
      if (found.location) setUtcOffsetMinutes(found.location.utcOffsetMinutes);
    }
  }, [session, useReal]);

  useEffect(() => {
    if (session === null) return;
    if (session && !session.candidateId) return;
    if (!session) return;
    refresh();
  }, [session, refresh]);

  useEffect(() => {
    if (candidate && !candidate.onboardingComplete) router.replace('/candidate/onboarding');
  }, [candidate, router]);

  // A single combined autosave (rather than one per field) so editing both
  // fields inside the same debounce window can never race two independent
  // PATCH calls against the same optimistic-concurrency version.
  const saveFields = useCallback(
    async (fields: {
      displayName: string;
      summary: string;
      country: string;
      utcOffsetMinutes: number;
      phone: string;
      linkedinUrl: string;
      websiteUrl: string;
      openTo: EngagementKind[];
      payDraft: CompensationDraft;
    }) => {
      if (!candidate) return;

      // Refused before the request rather than after it. Autosave fires on a
      // pause in typing, so a half-typed number would otherwise produce a
      // 400 on nearly every keystroke; and letting the save "succeed" while
      // silently dropping the invalid field would put "All changes saved"
      // under a value that was never stored.
      const contactProblem =
        contactError(fields.phone) ??
        contactError(fields.linkedinUrl, 'linkedin') ??
        contactError(fields.websiteUrl, 'website');
      if (contactProblem) throw new Error(contactProblem);

      // A half finished pay range is stopped for the same reason: it is a
      // state somebody passes through while typing, and saving it would
      // write a figure they had not finished stating.
      const { range: minimumCompensation, problem: payProblem } = compensationFromDraft(
        fields.payDraft,
      );
      if (payProblem) throw new Error(payProblem);

      // Empty means take it down, which is null for the same reason location
      // is: undefined would leave a previously given number in place, so a
      // candidate could never remove one.
      const phoneValue = fields.phone.trim() === '' ? null : fields.phone.trim();
      const linkedinValue = fields.linkedinUrl.trim() === '' ? null : fields.linkedinUrl.trim();
      const websiteValue = fields.websiteUrl.trim() === '' ? null : fields.websiteUrl.trim();

      // null rather than undefined when the country is blank: undefined
      // would mean "this update does not mention location" and leave a
      // previously stated one in place, so a candidate could never take it
      // back. null clears it.
      const location =
        fields.country === ''
          ? null
          : { country: fields.country, utcOffsetMinutes: fields.utcOffsetMinutes };

      if (useReal) {
        if (version === null) return;
        const result = await realCandidateProfile.updateProfile(version, {
          displayName: fields.displayName,
          summary: fields.summary,
          location,
          phone: phoneValue,
          linkedinUrl: linkedinValue,
          websiteUrl: websiteValue,
          // Null clears it, for the same reason location and the contact
          // channels do: undefined would mean "this update does not
          // mention intent" and leave a previously stated preference in
          // place, so it could never be withdrawn.
          intent:
            fields.openTo.length === 0 && !minimumCompensation
              ? null
              : {
                  openTo: fields.openTo,
                  note: '',
                  ...(minimumCompensation ? { minimumCompensation } : {}),
                },
        });
        setCandidate(result.candidate);
        setVersion(result.version);
        return;
      }

      // The two location inputs are rebuilt into one object above, so they
      // are not spread individually. A cleared location deletes the key
      // rather than storing null, matching what the repository does.
      const next = {
        ...candidate,
        displayName: fields.displayName,
        summary: fields.summary,
        updatedAt: new Date().toISOString(),
      };
      if (location) next.location = location;
      else delete next.location;
      if (phoneValue) next.phone = phoneValue;
      else delete next.phone;
      if (linkedinValue) next.linkedinUrl = linkedinValue;
      else delete next.linkedinUrl;
      if (websiteValue) next.websiteUrl = websiteValue;
      else delete next.websiteUrl;
      // Same delete-when-empty rule as the fields above, and the same
      // reason it is spelled out rather than spread: this object is
      // rebuilt key by key, so a field nobody adds here is saved on the
      // real path and silently lost on this one. That is exactly what
      // happened when intent was added — the page reported "All changes
      // saved" and the values were gone after a reload.
      const statedIntent =
        fields.openTo.length === 0 && !minimumCompensation
          ? null
          : {
              openTo: fields.openTo,
              note: '',
              ...(minimumCompensation ? { minimumCompensation } : {}),
            };
      if (statedIntent) next.intent = statedIntent;
      else delete next.intent;
      getLocalAdapters().data.upsertCandidate(next);
    },
    [candidate, useReal, version],
  );

  const countryOptions = useMemo(() => countriesByName(), []);
  const offsetOptions = useMemo(() => utcOffsetOptions(), []);

  const formFields = useMemo(
    () => ({
      displayName,
      summary,
      country,
      utcOffsetMinutes,
      phone,
      linkedinUrl,
      websiteUrl,
      openTo,
      payDraft,
    }),
    [
      displayName,
      summary,
      country,
      utcOffsetMinutes,
      phone,
      linkedinUrl,
      websiteUrl,
      openTo,
      payDraft,
    ],
  );
  const { status: saveStatus, reason: saveReason } = useDebouncedAutosave(formFields, saveFields);
  const saving = saveStatus === 'saving';
  const saveFailed = saveStatus === 'error';

  async function toggleDiscovery() {
    if (!candidate) return;

    if (useReal) {
      if (consentBusy) return;
      // discoveryOptIn isn't accepted by updateProfile — the real backend
      // routes consent changes through privacy.ts's updateConsent instead
      // (its own audited, versioned path). Re-fetch afterward since that
      // call doesn't return the profile's new optimistic-concurrency version.
      setConsentBusy(true);
      try {
        await realPrivacy.updateConsent({ discoveryOptIn: !candidate.discoveryOptIn });
        refresh();
      } catch (error) {
        showToast(
          messageFor(error, 'Something went wrong changing discovery. Try again.'),
          'error',
        );
      } finally {
        setConsentBusy(false);
      }
      return;
    }

    getLocalAdapters().data.upsertCandidate({
      ...candidate,
      discoveryOptIn: !candidate.discoveryOptIn,
      updatedAt: new Date().toISOString(),
    });
    refresh();
  }

  /**
   * Contact-sharing consent is separate from discovery on purpose, and it is
   * the one the server actually enforces: unlockContact refuses outright
   * unless `contactUnlockConsent` is true. Until this control existed, no
   * candidate could set it — so on the real backend no employer could ever
   * unlock a contact, which is the one thing a marketplace subscription is
   * metered on.
   */
  const [publicProofBusy, setPublicProofBusy] = useState(false);

  /**
   * The third consent, and the one that reaches furthest: the other two
   * decide who inside the product may see something, this decides whether
   * anybody at all can. It goes through the same audited endpoint as the
   * others rather than somewhere quieter, and the server mints or destroys
   * the id — nothing here invents one.
   */
  async function togglePublicProof(enabled: boolean) {
    if (!candidate) return;
    if (!useReal) {
      showToast('Publishing a proof page needs the real backend.', 'error');
      return;
    }
    setPublicProofBusy(true);
    try {
      await realPrivacy.updateConsent({ publicProof: enabled });
      refresh();
      showToast(
        enabled
          ? 'Your public page is live.'
          : 'Your public page is off, and the old link no longer works.',
        'success',
      );
    } catch (error) {
      showToast(messageFor(error, "Couldn't change that. Try again."), 'error');
    } finally {
      setPublicProofBusy(false);
    }
  }

  async function toggleContactConsent() {
    if (!candidate) return;

    if (useReal) {
      if (consentBusy) return;
      setConsentBusy(true);
      try {
        await realPrivacy.updateConsent({
          contactUnlockConsent: !candidate.contactUnlockConsent,
        });
        refresh();
      } catch (error) {
        showToast(
          messageFor(error, 'Something went wrong changing contact sharing. Try again.'),
          'error',
        );
      } finally {
        setConsentBusy(false);
      }
      return;
    }

    getLocalAdapters().data.upsertCandidate({
      ...candidate,
      contactUnlockConsent: !candidate.contactUnlockConsent,
      updatedAt: new Date().toISOString(),
    });
    refresh();
  }

  async function deleteEvidenceItem(evidenceId: string) {
    if (!candidate) return;

    if (useReal) {
      try {
        await realEvidenceClaims.deleteEvidence(evidenceId);
        refresh();
      } catch (error) {
        showToast(
          messageFor(error, 'Something went wrong deleting that evidence. Try again.'),
          'error',
        );
      } finally {
        setConfirmDeleteId(null);
      }
      return;
    }

    getLocalAdapters().data.deleteEvidence(candidate.id, evidenceId);
    refresh();
    setConfirmDeleteId(null);
  }

  if (!candidate) {
    if (loadFailed) {
      return (
        <Section className="max-w-md">
          <StatusState
            kind="500"
            action={
              <Button variant="secondary" onClick={refresh}>
                Try again
              </Button>
            }
          />
        </Section>
      );
    }
    return (
      <Section>
        <PageLoading blocks={3} />
      </Section>
    );
  }

  return (
    <Section>
      <PageHeader title="Your proof profile" />

      {/*
        `min-w-0` on the grid item is load-bearing. A `1fr` track is really
        `minmax(auto, 1fr)`, and that `auto` minimum means "at least as wide
        as the content" — so one long unbroken word in a candidate's evidence
        claim sized the whole track to 2935px inside a 587px grid and pushed
        the page sideways. Resetting the minimum lets the track shrink and the
        text wrap instead.
      */}
      <div className="mb-8">
        <ThresholdPanel
          discoveryOptIn={candidate.discoveryOptIn}
          evidence={evidence}
          /*
            Read from the form's own state rather than the loaded record, so
            the panel answers about what is on screen. A candidate who types
            a phone number and saves sees the bar clear without a reload.
          */
          contact={{
            ...(phone.trim() ? { phone: phone.trim() } : {}),
            ...(linkedinUrl.trim() ? { linkedinUrl: linkedinUrl.trim() } : {}),
            ...(websiteUrl.trim() ? { websiteUrl: websiteUrl.trim() } : {}),
          }}
        />
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Input
            id="display-name"
            maxLength={TEXT_LIMITS.displayName}
            label="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <Textarea
            id="summary"
            maxLength={TEXT_LIMITS.summary}
            label="Summary"
            hint="A short overview of the work you want to be known for."
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={4}
          />

          {/*
            Optional, and said so plainly rather than left to be inferred
            from an empty field. These reach an employer only after they
            have unlocked contact and only while consent stands, which is
            the same gate the email address goes through — worth stating
            here, because somebody typing their phone number into a hiring
            site deserves to know who ends up seeing it before they type it,
            not after.
          */}
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="font-bold text-ink-950">How employers can reach you</h2>
              <p className="mt-1 text-sm text-ink-700">
                Both optional. An employer sees these only after they unlock your contact details,
                and only while you allow contact sharing. Leaving them blank never removes you from
                a shortlist.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                id="phone"
                label="Phone number"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                hint="With the country code, like +234 801 234 5678."
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                {...(contactError(phone) ? { error: contactError(phone)! } : {})}
              />
              <Input
                id="linkedin-url"
                label="LinkedIn profile"
                type="url"
                inputMode="url"
                autoComplete="url"
                hint="The full address of your profile page."
                placeholder="https://www.linkedin.com/in/your-name"
                value={linkedinUrl}
                onChange={(e) => setLinkedinUrl(e.target.value)}
                {...(contactError(linkedinUrl, 'linkedin')
                  ? { error: contactError(linkedinUrl, 'linkedin')! }
                  : {})}
              />
              {/*
                Anywhere else they would rather be found.

                Profile photos used to sit above this. They are gone, because
                a face beside a ranked shortlist is how demographic bias
                reaches screening, and this is the honest replacement: a link
                somebody chose to publish says more about their work than a
                photograph does, and it is theirs to change.

                Unlike the LinkedIn field this accepts any https address, so
                the label says what it is for rather than naming one company.
              */}
              <Input
                id="website-url"
                label="Another link"
                type="url"
                inputMode="url"
                autoComplete="url"
                hint="Optional. A GitHub profile, a personal site, anywhere you would rather be found."
                placeholder="https://github.com/your-name"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                {...(contactError(websiteUrl, 'website')
                  ? { error: contactError(websiteUrl, 'website')! }
                  : {})}
              />
            </div>
          </div>

          {/*
            What they are open to and what they need to be paid.

            Placed after the contact channels because it is the same kind
            of thing: optional, theirs to state or withdraw, and never
            held against them when unstated. Matching reads an unstated
            preference as no constraint, which is what makes answering
            safe rather than a commitment.
          */}
          <div className="mt-8 border-t border-warm-200 pt-6">
            <OpenToFields value={openTo} onChange={setOpenTo} />
            <CompensationFields
              idPrefix="candidate-pay"
              legend="What do you need to be paid?"
              hint="Optional, and never shown to an employer as a demand. A role that pays below this still appears, marked with the gap, so you can decide for yourself rather than never seeing it."
              value={payDraft}
              onChange={setPayDraft}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              id="country"
              label="Where you work from"
              hint="Optional. Employers can filter on this. Leaving it blank never removes you from a shortlist."
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            >
              <option value="">Rather not say</option>
              {countryOptions.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.name}
                </option>
              ))}
            </Select>
            <Select
              id="utc-offset"
              label="Your working hours"
              /*
                Says why it is off when it is off. This control is disabled
                until a country is chosen, and the country select is a
                separate field above it, so with the old single sentence
                there was nothing connecting the two: a greyed-out dropdown
                with no stated reason reads as broken rather than as
                waiting. The verify page already words its disabled state
                this way; this is the same rule applied here.
              */
              hint={
                country === ''
                  ? 'Choose a country above and this turns on. Working hours are worked out relative to it.'
                  : 'Used to work out how much of the day you share with a role.'
              }
              value={String(utcOffsetMinutes)}
              onChange={(e) => setUtcOffsetMinutes(Number(e.target.value))}
              disabled={country === ''}
            >
              {offsetOptions.map((option) => (
                <option key={option.minutes} value={option.minutes}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>

          <p aria-live="polite" className="text-sm text-ink-500">
            {/*
              The reason when there is one. Most refusals here are not
              faults but something to correct in a field on this page, and
              a single "try again" for every cause tells somebody to repeat
              the thing that will not work.
            */}
            {saving
              ? 'Saving…'
              : saveFailed
                ? (saveReason ?? 'Something went wrong saving your changes. Try again.')
                : 'All changes saved.'}
          </p>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xl font-bold text-ink-950">Your claims</h2>
              <ButtonLink href="/candidate/evidence/new">File a claim</ButtonLink>
            </div>
            <p className="mb-4 text-sm text-ink-700">
              A claim is something you say. A proof is a claim we checked against a source you do
              not control. Employers only ever see proofs; an unchecked claim stays here, for you.
              {liveProofCount > 0
                ? ` ${liveProofCount} of ${evidence.length} proved so far.`
                : ' Nothing is proved yet.'}
            </p>
            {evidence.length === 0 ? (
              <Card>
                <p className="text-sm text-ink-700">
                  Nothing filed yet. A claim is four lines: what you did, where, what you personally
                  did, and what changed.
                </p>
              </Card>
            ) : (
              <ul className="flex flex-col gap-3">
                {evidence.map((item) => (
                  <li key={item.id}>
                    <Card>
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="font-medium break-words text-ink-950">{item.claim}</p>
                          <div className="mt-3 flex flex-wrap items-start gap-x-4 gap-y-2">
                            <ProofMark
                              state={proofMarkState(item)}
                              size="sm"
                              checkedAt={item.verifiedAt}
                              lapsesAt={item.verificationExpiresAt}
                              detail={item.verificationDetail}
                            />
                            <Badge tone="neutral">
                              {EVIDENCE_VISIBILITY_LABELS[item.visibility]}
                            </Badge>
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          {proofMarkState(item) === 'proved' ? null : (
                            <ButtonLink href={`/candidate/evidence/verify?id=${item.id}`}>
                              {proofMarkState(item) === 'lapsed' ? 'Check again' : 'Get it checked'}
                            </ButtonLink>
                          )}
                          <ButtonLink
                            href={`/candidate/evidence/edit?id=${item.id}`}
                            variant="secondary"
                          >
                            Edit
                          </ButtonLink>
                          <Button variant="secondary" onClick={() => setConfirmDeleteId(item.id)}>
                            Delete
                          </Button>
                        </div>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <aside className="flex flex-col gap-4">
          <Card>
            <h2 className="font-semibold text-ink-950">Your specialism</h2>
            <p className="mt-1 text-sm text-ink-700">
              {LAUNCH_TRACK_LABELS[candidate.launchTrack]}
            </p>
          </Card>
          <Card>
            <h2 className="font-semibold text-ink-950">What employers can see</h2>
            <div className="mt-3 space-y-4">
              <Checkbox
                id="discovery-opt-in"
                label="Opt into employer discovery"
                hint="When on, employers with a matching role can find your profile, and we email you when one opens your proof. Turning this off removes you immediately and stops those emails."
                checked={candidate.discoveryOptIn}
                disabled={consentBusy}
                onChange={() => void toggleDiscovery()}
              />
              <Checkbox
                id="contact-unlock-consent"
                label="Let employers unlock my contact details"
                hint={
                  candidate.discoveryOptIn
                    ? 'Separate from the setting above. Employers can already read your evidence; this is what lets one spend an unlock to see your email. You are told each time it happens, and you can turn this off whenever you like.'
                    : 'Only matters once employer discovery is on. Employers cannot find you at all right now.'
                }
                checked={candidate.contactUnlockConsent === true}
                disabled={consentBusy}
                onChange={() => void toggleContactConsent()}
              />
            </div>
          </Card>
          <PublicProofPanel
            publicProofId={candidate.publicProofId}
            pageUrl={(id) => `${siteOrigin()}/proof?id=${encodeURIComponent(id)}`}
            badgeUrl={(id) => realPublicProof.badgeUrl(apiOrigin(), id)}
            onChange={togglePublicProof}
            busy={publicProofBusy}
          />
          <ButtonLink href="/candidate/profile/preview" variant="secondary">
            Preview as an employer would see it
          </ButtonLink>
        </aside>
      </div>

      <Dialog
        open={confirmDeleteId !== null}
        onClose={() => setConfirmDeleteId(null)}
        title="Delete this evidence item?"
      >
        <p className="text-sm text-ink-700">
          {'"'}
          {evidence.find((item) => item.id === confirmDeleteId)?.claim}
          {'" '}
          will be permanently deleted. This can't be undone.
        </p>
        <div className="mt-4 flex gap-3">
          <Button
            variant="danger"
            onClick={() => confirmDeleteId && void deleteEvidenceItem(confirmDeleteId)}
          >
            Yes, delete
          </Button>
          <Button variant="secondary" onClick={() => setConfirmDeleteId(null)}>
            Cancel
          </Button>
        </div>
      </Dialog>
    </Section>
  );
}
