import type { Metadata } from 'next';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageHeader, Section } from '@/components/layout/Section';

export const metadata: Metadata = {
  title: 'For Talent — Zoryvex',
  description:
    'Show the work you have done and have it checked. Free for candidates, with no employer able to see your contact details until you agree.',
};

export default function ForTalentPage() {
  return (
    <>
      <Section>
        <PageHeader
          title="Show your work. It's free."
          intro="Zoryvex is for candidates in cloud engineering, DevOps/platform, cloud-security, and MLOps roles who have real work to show, not just a title. Building a proof profile costs nothing, now or ever."
        />
        <ButtonLink href="/sign-in" size="lg">
          Build your proof profile
        </ButtonLink>
      </Section>

      <Section>
        <h2 className="text-2xl font-bold text-ink-950">Four lines, then a check</h2>
        <p className="mt-2 text-ink-700">
          Instead of a bullet-point résumé, you file one claim per piece of real work. Four lines
          each. The third is the hard one, and it is the one that decides whether a check can
          confirm anything.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {[
            ['Claim', 'What you did, in one sentence.'],
            ['Context', 'Where, and what state it was in when you got there.'],
            ['Actions', 'What you personally did. Not the team.'],
            ['Outcome', 'What changed, measurably.'],
          ].map(([label, body]) => (
            <Card key={label}>
              <h3 className="font-semibold text-ink-950">{label}</h3>
              <p className="mt-2 text-sm text-ink-700">{body}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section>
        <h2 className="text-2xl font-bold text-ink-950">You control what's visible</h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-ink-700">
          <li>Every claim you file is private by default.</li>
          {/*
            "per launch track" described a control that does not exist. A
            candidate has exactly one `launchTrack` and one `discoveryOptIn`
            flag, which the section below this one says plainly, so the two
            contradicted each other on the same page. The track argument to
            setDiscoveryOptIn is a GSI partition key, not a per-track toggle.
          */}
          <li>You choose whether employers can discover you at all, and can change it whenever.</li>
          <li>Contact details are only unlocked with your explicit consent.</li>
          <li>You can export or delete your data at any time.</li>
        </ul>
      </Section>

      <Section>
        <h2 className="text-2xl font-bold text-ink-950">One launch track at a time</h2>
        <p className="mt-2 text-ink-700">
          Onboarding starts with picking a single track: cloud engineering, DevOps/platform,
          cloud-security/DevSecOps, or MLOps/ML platform. Your profile stays focused on work that
          actually matches the roles you want.
        </p>
      </Section>
    </>
  );
}
