import { describe, expect, it } from 'vitest';
import { renderKitHtmlDocument } from '../src/kit-html-document';
import { generateKitDeliverables } from '../src/kit-deliverables';
import type { Role } from '@zoryvex/contracts';

const baseRole: Role = {
  id: 'role_1',
  employerId: 'emp_1',
  launchTrack: 'aws_cloud',
  title: 'Cloud Engineer',
  seniority: 'mid',
  outcomes: 'Ship infra reliably',
  mustHaveWork: ['Wrote Terraform for a real environment'],
  constraints: '',
  status: 'draft',
  createdAt: '2026-08-19T00:00:00.000Z',
};

const now = new Date('2026-08-19T00:00:00.000Z');

describe('renderKitHtmlDocument', () => {
  it('produces a document with the mobile viewport meta tag', () => {
    const html = renderKitHtmlDocument(baseRole, generateKitDeliverables(baseRole, now));
    expect(html).toContain('name="viewport"');
    expect(html).toContain('width=device-width');
  });

  it('declares a language and a title reflecting the role', () => {
    const html = renderKitHtmlDocument(baseRole, generateKitDeliverables(baseRole, now));
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('Cloud Engineer');
  });

  it('includes a print media query with page-break avoidance', () => {
    const html = renderKitHtmlDocument(baseRole, generateKitDeliverables(baseRole, now));
    expect(html).toContain('@media print');
    expect(html).toMatch(/break-inside:\s*avoid/);
  });

  it('includes a skip link and focus-visible styling for keyboard access', () => {
    const html = renderKitHtmlDocument(baseRole, generateKitDeliverables(baseRole, now));
    expect(html).toContain('skip-link');
    expect(html).toContain(':focus-visible');
  });

  it('uses a real semantic table with a caption and column scope for the verification matrix', () => {
    const html = renderKitHtmlDocument(baseRole, generateKitDeliverables(baseRole, now));
    expect(html).toContain('<table>');
    expect(html).toContain('<caption');
    expect(html).toContain('scope="col"');
  });

  it('escapes HTML-significant characters in employer-supplied text (XSS safety)', () => {
    const role: Role = { ...baseRole, title: '<script>alert(1)</script>' };
    const html = renderKitHtmlDocument(role, generateKitDeliverables(role, now));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  /**
   * The test above only covered `title`, but every one of these fields is
   * employer-typed free text that reaches the rendered document, and
   * `mustHaveWork` fans out into five separate sections (checklist,
   * verification matrix, rubric, interview guide, scorecard). This Kit is
   * downloaded and opened as a standalone file, so an unescaped payload
   * would execute in that document's own context — worth covering every
   * field rather than trusting that a future edit remembers to escape.
   */
  it.each([
    ['title', (payload: string): Role => ({ ...baseRole, title: payload })],
    ['outcomes', (payload: string): Role => ({ ...baseRole, outcomes: payload })],
    ['constraints', (payload: string): Role => ({ ...baseRole, constraints: payload })],
    ['mustHaveWork', (payload: string): Role => ({ ...baseRole, mustHaveWork: [payload] })],
  ])('escapes an injected payload in employer-supplied %s', (_field, build) => {
    const payload = `<img src=x onerror="alert('pwned')">`;
    const role = build(payload);
    const html = renderKitHtmlDocument(role, generateKitDeliverables(role, now));

    // The raw tag must never survive anywhere in the output.
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('onerror="alert');
    // And the payload must actually be present, escaped — proving it was
    // rendered-and-escaped rather than silently dropped, which would pass a
    // naive "not.toContain" assertion for the wrong reason.
    expect(html).toContain('&lt;img src=x');
  });

  it('escapes quotes and ampersands without double-escaping the ampersand', () => {
    const role: Role = { ...baseRole, title: `Tom & "Jerry" O'Brien` };
    const html = renderKitHtmlDocument(role, generateKitDeliverables(role, now));
    expect(html).toContain('Tom &amp; &quot;Jerry&quot; O&#39;Brien');
    // `&amp;amp;` would mean the ampersand was escaped twice, which renders
    // as a literal "&amp;" to the reader.
    expect(html).not.toContain('&amp;amp;');
  });

  it('omits the constraints paragraph entirely when constraints is empty', () => {
    const role: Role = { ...baseRole, constraints: '' };
    const html = renderKitHtmlDocument(role, generateKitDeliverables(role, now));
    expect(html).not.toContain('Constraints:');
  });

  it('includes the constraints paragraph when constraints is set', () => {
    const role: Role = { ...baseRole, constraints: 'Remote-friendly, EU timezone overlap' };
    const html = renderKitHtmlDocument(role, generateKitDeliverables(role, now));
    expect(html).toContain('Constraints:');
    expect(html).toContain('Remote-friendly, EU timezone overlap');
  });

  it('handles a very long title without throwing, wrapped rather than clipped', () => {
    const role: Role = { ...baseRole, title: 'A'.repeat(500) };
    const html = renderKitHtmlDocument(role, generateKitDeliverables(role, now));
    expect(html).toContain('A'.repeat(500));
    expect(html).toContain('overflow-wrap');
  });

  it('handles a role with a single mustHaveWork item (minimum allowed) without an empty list', () => {
    const role: Role = { ...baseRole, mustHaveWork: ['Solo requirement'] };
    const html = renderKitHtmlDocument(role, generateKitDeliverables(role, now));
    expect(html).toContain('Solo requirement');
  });

  it('never fabricates candidate identity anywhere in the document', () => {
    const html = renderKitHtmlDocument(baseRole, generateKitDeliverables(baseRole, now));
    expect(html.toLowerCase()).not.toMatch(/candidate name|applicant:/);
  });
});
