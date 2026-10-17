import type { Role } from '@zoryvex/contracts';
import type { KitDeliverables } from './kit-deliverables';

/**
 * Renders a fully self-contained, accessible HTML document for a
 * generated Kit — no external stylesheet/font/script, safe to download and
 * open standalone or print. Prompt 7: "The Kit must be accessible HTML
 * plus print/download output created inside the AWS app. Do not introduce
 * a PDF/SaaS account." Printing is the browser's own print-to-PDF over the
 * embedded print stylesheet; "download" is this same HTML file.
 */
export function renderKitHtmlDocument(role: Role, deliverables: KitDeliverables): string {
  const title = `Proof Hiring Kit — ${escapeHtml(role.title)}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>${STYLES}</style>
</head>
<body>
<a class="skip-link" href="#main">Skip to Kit content</a>
<header>
  <div class="header-row">
    <div>
      <h1>${title}</h1>
      <p class="meta">Template version ${deliverables.version} · generated ${escapeHtml(new Date(deliverables.generatedAt).toUTCString())}</p>
    </div>
    <button type="button" id="print-button" class="print-only-hide">Print / save as PDF</button>
  </div>
</header>
<main id="main">
  <section aria-labelledby="role-success-profile-heading">
    <h2 id="role-success-profile-heading">Role success profile</h2>
    <p>${escapeHtml(deliverables.roleSuccessProfile.outcomes)}</p>
    <p>Seniority: ${escapeHtml(deliverables.roleSuccessProfile.seniority)}</p>
    ${role.constraints ? `<p>Constraints: ${escapeHtml(role.constraints)}</p>` : ''}
  </section>

  <section aria-labelledby="evidence-checklist-heading">
    <h2 id="evidence-checklist-heading">Evidence checklist</h2>
    <ul>
      ${deliverables.evidenceChecklist.map((item) => `<li>${escapeHtml(item)}</li>`).join('\n      ')}
    </ul>
  </section>

  <section aria-labelledby="claim-verification-heading">
    <h2 id="claim-verification-heading">Claim-verification matrix</h2>
    <table>
      <caption class="sr-only">Claims to verify and how to verify each one</caption>
      <thead>
        <tr>
          <th scope="col">Claim</th>
          <th scope="col">How to verify</th>
        </tr>
      </thead>
      <tbody>
        ${deliverables.claimVerificationMatrix
          .map(
            (row) =>
              `<tr><td>${escapeHtml(row.claim)}</td><td>${escapeHtml(row.howToVerify)}</td></tr>`,
          )
          .join('\n        ')}
      </tbody>
    </table>
  </section>

  <section aria-labelledby="rubric-heading">
    <h2 id="rubric-heading">Practical assessment rubric</h2>
    <ul>
      ${deliverables.practicalAssessmentRubric
        .map(
          (row) =>
            `<li><strong>${escapeHtml(row.criterion)}:</strong> ${escapeHtml(row.passingBar)}</li>`,
        )
        .join('\n      ')}
    </ul>
  </section>

  <section aria-labelledby="interview-guide-heading">
    <h2 id="interview-guide-heading">Structured interview guide</h2>
    <ol>
      ${deliverables.structuredInterviewGuide.map((q) => `<li>${escapeHtml(q)}</li>`).join('\n      ')}
    </ol>
  </section>

  <section aria-labelledby="scorecard-heading">
    <h2 id="scorecard-heading">Decision scorecard</h2>
    <ul>
      ${deliverables.decisionScorecard.map((item) => `<li>${escapeHtml(item)}</li>`).join('\n      ')}
    </ul>
  </section>
</main>
<script>
  document.getElementById('print-button')?.addEventListener('click', function () { window.print(); });
</script>
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLES = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #1a1a1a;
    background: #ffffff;
    line-height: 1.5;
    overflow-wrap: break-word;
  }
  .skip-link {
    position: absolute;
    left: -9999px;
    top: 0;
    background: #1a1a1a;
    color: #ffffff;
    padding: 0.5rem 1rem;
    z-index: 10;
  }
  .skip-link:focus { left: 0.5rem; top: 0.5rem; }
  .sr-only {
    position: absolute;
    width: 1px; height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
  }
  header {
    padding: 1.5rem;
    border-bottom: 1px solid #d9d2c5;
  }
  .header-row {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    max-width: 60rem;
    margin: 0 auto;
  }
  h1 { font-size: 1.375rem; margin: 0 0 0.25rem; }
  .meta { margin: 0; font-size: 0.875rem; color: #57534e; }
  main {
    max-width: 60rem;
    margin: 0 auto;
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  section {
    border: 1px solid #e7e2d8;
    border-radius: 0.5rem;
    padding: 1rem 1.25rem;
    break-inside: avoid;
  }
  h2 { font-size: 1.0625rem; margin: 0 0 0.5rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9375rem; }
  th, td { text-align: left; padding: 0.5rem 0.75rem 0.5rem 0; border-top: 1px solid #e7e2d8; }
  th:first-child, td:first-child { padding-left: 0; }
  ul, ol { margin: 0; padding-left: 1.25rem; font-size: 0.9375rem; }
  li { margin-bottom: 0.375rem; }
  button {
    font: inherit;
    padding: 0.5rem 1rem;
    border-radius: 0.375rem;
    border: 1px solid #1a1a1a;
    background: #ffffff;
    cursor: pointer;
  }
  button:hover { background: #f5f2ea; }
  :focus-visible { outline: 2px solid #1a1a1a; outline-offset: 2px; }

  @media (max-width: 40rem) {
    header, main { padding: 1rem; }
    .header-row { flex-direction: column; }
  }

  @media print {
    .print-only-hide { display: none; }
    body { background: #ffffff; }
    section { border: none; padding: 0; break-inside: avoid; page-break-inside: avoid; }
    main { gap: 1rem; }
    a.skip-link { display: none; }
  }
`;
