'use client';

import type { KitDeliverables } from '@zoryvex/kit-templates';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

export function KitDeliverablesView({ deliverables }: { deliverables: KitDeliverables }) {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <p className="text-sm text-ink-500">
          Version {deliverables.version} · generated{' '}
          {new Date(deliverables.generatedAt).toLocaleString()}
        </p>
        <Button variant="secondary" onClick={() => window.print()}>
          Print / save as PDF
        </Button>
      </div>

      <div className="flex flex-col gap-6">
        <Card>
          <h3 className="font-semibold text-ink-950">Role success profile</h3>
          <p className="mt-2 text-sm text-ink-700">{deliverables.roleSuccessProfile.outcomes}</p>
          <p className="mt-1 text-sm text-ink-700">
            Seniority: {deliverables.roleSuccessProfile.seniority}
          </p>
        </Card>

        <Card>
          <h3 className="font-semibold text-ink-950">Evidence checklist</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-700">
            {deliverables.evidenceChecklist.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Card>

        <Card>
          <h3 className="font-semibold text-ink-950">Claim-verification matrix</h3>
          <table className="mt-2 w-full text-left text-sm">
            <thead>
              <tr className="text-ink-700">
                <th scope="col" className="pb-2 pr-4 font-medium">
                  Claim
                </th>
                <th scope="col" className="pb-2 font-medium">
                  How to verify
                </th>
              </tr>
            </thead>
            <tbody>
              {deliverables.claimVerificationMatrix.map((row) => (
                <tr key={row.claim} className="border-t border-warm-200">
                  <td className="py-2 pr-4 text-ink-700">{row.claim}</td>
                  <td className="py-2 text-ink-700">{row.howToVerify}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card>
          <h3 className="font-semibold text-ink-950">Practical assessment rubric</h3>
          <ul className="mt-2 space-y-2 text-sm text-ink-700">
            {deliverables.practicalAssessmentRubric.map((row) => (
              <li key={row.criterion}>
                <span className="font-medium text-ink-950">{row.criterion}:</span> {row.passingBar}
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <h3 className="font-semibold text-ink-950">Structured interview guide</h3>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink-700">
            {deliverables.structuredInterviewGuide.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ol>
        </Card>

        <Card>
          <h3 className="font-semibold text-ink-950">Decision scorecard</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-700">
            {deliverables.decisionScorecard.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
