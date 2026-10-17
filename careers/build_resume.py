#!/usr/bin/env python3
"""Build ATS-friendly .docx and .pdf resumes with no third-party dependencies.

Both formats are written by hand:

  * .docx is an OOXML package, which is a zip of XML parts.
  * .pdf is written directly, using the base-14 Helvetica fonts so no font
    embedding is needed and the text stays extractable by ATS parsers.

The repository already prefers hand-rolled, dependency-free tooling
(scripts/process-founder-photo.mjs does the same for JPEG metadata), and this
pass is documentation-only, so adding a package was not an option.

Usage:
    python careers/build_resume.py
"""

import os
import zipfile
from datetime import datetime, timezone

OUT_DIR = os.path.dirname(os.path.abspath(__file__))

# --------------------------------------------------------------------------
# Content. Edit here; both formats regenerate from it.
# --------------------------------------------------------------------------

NAME = "[FULL NAME]"
CONTACT = (
    "[CITY, COUNTRY] | [EMAIL] | [PHONE] | "
    "linkedin.com/in/[HANDLE] | github.com/[HANDLE]"
)

SUMMARY = (
    "Technical product owner. Specified, architected and shipped Zoryvex, a live "
    "proof-first hiring platform on AWS serverless: 55 Lambda functions, 51 API "
    "routes, single-table DynamoDB, Terraform-managed infrastructure, live "
    "payments. Built and operated solo. Decisions documented in six architecture "
    "decision records, including two that removed shipped features because they "
    "could not be verified honestly."
)

EXPERIENCE = [
    (
        "Founder and Technical Product Owner",
        "Zoryvex",
        "Aug 2026 - Present",
        [
            "Specified and shipped a live hiring platform verifying candidate claims "
            "against third-party sources: 55 AWS Lambda functions across 51 API routes, "
            "44 behind a fail-closed authorizer, backed by single-table DynamoDB.",
            "Directed all architecture decisions and recorded them in six ADRs, including "
            "rejecting Amazon Cognito in favour of passwordless email auth with opaque "
            "server-side sessions, and choosing static export on CloudFront with origin "
            "access control over any always-on compute.",
            "Retired a shipped verification method after determining a language model could "
            "pass it from the published brief, accepting reduced product scope in exchange "
            "for a defensible claim.",
            "Removed two further evidence paths, file upload and peer confirmation, on the "
            "principle that a source the candidate controls or selects is not independent "
            "verification.",
            "Integrated Paystack with HMAC-SHA512 webhook verification, payload-hash "
            "deduplication and hourly reconciliation; proved forgery rejection, signature "
            "acceptance and replay deduplication against the live account.",
            "Diagnosed eleven consecutive live payment failures to gateway evidence: eight "
            "abandonments and three test cards presented to a live account. Concluded there "
            "was no product defect and changed nothing.",
            "Built deployment safety after shipping a demo build to production: the release "
            "process now refuses to build without an https API URL read from Terraform "
            "output, refuses to upload if a demo marker is present, and smoke-tests the "
            "deployed commit.",
            "Enforced cost control by design: reserved concurrency on all 55 functions, "
            "on-demand DynamoDB, no NAT Gateway, no always-on compute, and feature flags "
            "read per invocation for sub-minute mitigation without a deploy.",
            "Established data-minimisation boundaries: stated minimum pay never leaves the "
            "candidate record, contact details are released only after mutual interest and "
            "an entitlement check, and AI inputs exclude all contact and protected fields.",
        ],
    ),
    (
        "[PREVIOUS ROLE TITLE]",
        "[COMPANY]",
        "[MMM YYYY - MMM YYYY]",
        [
            "[PLACEHOLDER: an achievement with a number in it]",
            "[PLACEHOLDER: an achievement showing ownership]",
            "[PLACEHOLDER: an achievement showing collaboration]",
        ],
    ),
    (
        "[EARLIER ROLE TITLE]",
        "[COMPANY]",
        "[MMM YYYY - MMM YYYY]",
        [
            "[PLACEHOLDER]",
            "[PLACEHOLDER]",
        ],
    ),
]

SKILLS = [
    "Cloud and infrastructure: AWS Lambda, API Gateway, DynamoDB, S3, CloudFront, "
    "SES, EventBridge, CloudWatch, Parameter Store, IAM, ACM, Terraform",
    "Product: technical specification, architecture decision records, trade-off "
    "analysis, pricing strategy, privacy and data-minimisation design",
    "Engineering practice: serverless architecture, single-table design, idempotency, "
    "webhook verification, feature flags, CI/CD, incident response",
    "Payments: Paystack integration, webhook signature verification, reconciliation",
    "Stack: TypeScript, Next.js, Node.js, GitHub Actions",
]

EDUCATION = ["[DEGREE], [INSTITUTION], [YEAR]"]

# --------------------------------------------------------------------------
# DOCX
# --------------------------------------------------------------------------

def xml_escape(text):
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def para(text, bold=False, size=22, space_after=120, bullet=False):
    """One <w:p>. size is in half-points, so 22 == 11pt."""
    ind = '<w:ind w:left="284" w:hanging="284"/>' if bullet else ""
    body = ("- " + text) if bullet else text
    return (
        "<w:p><w:pPr>"
        f'<w:spacing w:after="{space_after}" w:line="240" w:lineRule="auto"/>'
        f"{ind}</w:pPr>"
        "<w:r><w:rPr>"
        + ("<w:b/>" if bold else "")
        + f'<w:sz w:val="{size}"/><w:szCs w:val="{size}"/>'
        "</w:rPr>"
        f'<w:t xml:space="preserve">{xml_escape(body)}</w:t>'
        "</w:r></w:p>"
    )


def build_docx(path):
    parts = []
    parts.append(para(NAME, bold=True, size=32, space_after=60))
    parts.append(para(CONTACT, size=18, space_after=240))

    parts.append(para("SUMMARY", bold=True, size=24, space_after=80))
    parts.append(para(SUMMARY, space_after=240))

    parts.append(para("EXPERIENCE", bold=True, size=24, space_after=80))
    for title, company, dates, bullets in EXPERIENCE:
        parts.append(para(f"{title}, {company}   {dates}", bold=True, space_after=60))
        for b in bullets:
            parts.append(para(b, space_after=60, bullet=True))
        parts.append(para("", size=8, space_after=120))

    parts.append(para("SKILLS", bold=True, size=24, space_after=80))
    for s in SKILLS:
        parts.append(para(s, space_after=60))
    parts.append(para("", size=8, space_after=120))

    parts.append(para("EDUCATION", bold=True, size=24, space_after=80))
    for e in EDUCATION:
        parts.append(para(e, space_after=60))

    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        "<w:body>" + "".join(parts) +
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
        '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" '
        'w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
        "</w:body></w:document>"
    )

    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
        "</Types>"
    )

    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        "</Relationships>"
    )

    doc_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        "</Relationships>"
    )

    styles = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        "<w:docDefaults><w:rPrDefault><w:rPr>"
        '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>'
        '<w:sz w:val="22"/><w:szCs w:val="22"/>'
        "</w:rPr></w:rPrDefault></w:docDefaults>"
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">'
        '<w:name w:val="Normal"/></w:style>'
        "</w:styles>"
    )

    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", root_rels)
        z.writestr("word/document.xml", document)
        z.writestr("word/_rels/document.xml.rels", doc_rels)
        z.writestr("word/styles.xml", styles)


# --------------------------------------------------------------------------
# PDF
# --------------------------------------------------------------------------

PAGE_W, PAGE_H = 595.28, 841.89          # A4 in points
MARGIN = 56.7                            # 20mm
LINE = 13.2
WIDTH = PAGE_W - 2 * MARGIN

# Helvetica base-14 advance widths (units/1000) for the printable ASCII range.
_W = {
    ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667, "'": 191,
    '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
    '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556,
    '8': 556, '9': 556, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556,
    '@': 1015, 'A': 667, 'B': 667, 'C': 722, 'D': 722, 'E': 667, 'F': 611, 'G': 778,
    'H': 722, 'I': 278, 'J': 500, 'K': 667, 'L': 556, 'M': 833, 'N': 722, 'O': 778,
    'P': 667, 'Q': 778, 'R': 722, 'S': 667, 'T': 611, 'U': 722, 'V': 667, 'W': 944,
    'X': 667, 'Y': 667, 'Z': 611, '[': 278, '\\': 278, ']': 278, '^': 469, '_': 556,
    '`': 333, 'a': 556, 'b': 556, 'c': 500, 'd': 556, 'e': 556, 'f': 278, 'g': 556,
    'h': 556, 'i': 222, 'j': 222, 'k': 500, 'l': 222, 'm': 833, 'n': 556, 'o': 556,
    'p': 556, 'q': 556, 'r': 333, 's': 500, 't': 278, 'u': 556, 'v': 500, 'w': 722,
    'x': 500, 'y': 500, 'z': 500, '{': 334, '|': 260, '}': 334, '~': 584,
}
# Bold widths differ; close enough for wrapping if we scale the few that matter.
_WB = dict(_W)
for _c in "abcdefghijklmnopqrstuvwxyz":
    _WB[_c] = _W[_c] + 28
for _c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
    _WB[_c] = _W[_c] + 22


def text_width(s, size, bold=False):
    table = _WB if bold else _W
    return sum(table.get(ch, 556) for ch in s) * size / 1000.0


def wrap(s, size, avail, bold=False):
    words, lines, cur = s.split(), [], ""
    for w in words:
        trial = w if not cur else cur + " " + w
        if text_width(trial, size, bold) <= avail:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines or [""]


def pdf_escape(s):
    return s.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def build_pdf(path):
    pages, ops, y = [], [], PAGE_H - MARGIN

    def newpage():
        nonlocal ops, y
        pages.append("".join(ops))
        ops, y = [], PAGE_H - MARGIN

    def draw(s, size=10, bold=False, indent=0.0, gap=0.0):
        nonlocal y
        font = "F2" if bold else "F1"
        for ln in wrap(s, size, WIDTH - indent, bold):
            if y - LINE < MARGIN:
                newpage()
            y -= LINE
            ops.append(
                f"BT /{font} {size} Tf 1 0 0 1 {MARGIN + indent:.2f} {y:.2f} Tm "
                f"({pdf_escape(ln)}) Tj ET\n"
            )
        y -= gap

    draw(NAME, size=17, bold=True, gap=2)
    draw(CONTACT, size=8.5, gap=10)

    draw("SUMMARY", size=11, bold=True, gap=2)
    draw(SUMMARY, size=10, gap=10)

    draw("EXPERIENCE", size=11, bold=True, gap=2)
    for title, company, dates, bullets in EXPERIENCE:
        draw(f"{title}, {company}   {dates}", size=10, bold=True, gap=1)
        for b in bullets:
            draw("- " + b, size=10, indent=10, gap=1)
        y -= 6

    draw("SKILLS", size=11, bold=True, gap=2)
    for s in SKILLS:
        draw(s, size=10, gap=1)
    y -= 6

    draw("EDUCATION", size=11, bold=True, gap=2)
    for e in EDUCATION:
        draw(e, size=10, gap=1)

    pages.append("".join(ops))

    # ---- assemble ----
    objs, n_pages = {}, len(pages)
    first_content = 4 + n_pages          # content streams follow the page objects

    kids = " ".join(f"{4 + i} 0 R" for i in range(n_pages))
    objs[1] = "<< /Type /Catalog /Pages 2 0 R >>"
    objs[2] = f"<< /Type /Pages /Kids [{kids}] /Count {n_pages} >>"
    objs[3] = (
        "<< /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica "
        "/Encoding /WinAnsiEncoding >> /F2 << /Type /Font /Subtype /Type1 "
        "/BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >> >> >>"
    )
    for i in range(n_pages):
        objs[4 + i] = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W:.2f} {PAGE_H:.2f}] "
            f"/Resources 3 0 R /Contents {first_content + i} 0 R >>"
        )

    out, offsets = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"), {}

    def emit(num, body):
        offsets[num] = len(out)
        out.extend(f"{num} 0 obj\n{body}\nendobj\n".encode("latin-1"))

    for num in sorted(objs):
        emit(num, objs[num])

    for i, stream in enumerate(pages):
        num = first_content + i
        data = stream.encode("latin-1")
        offsets[num] = len(out)
        out.extend(f"{num} 0 obj\n<< /Length {len(data)} >>\nstream\n".encode("latin-1"))
        out.extend(data)
        out.extend(b"\nendstream\nendobj\n")

    total = first_content + n_pages
    xref_at = len(out)
    out.extend(f"xref\n0 {total}\n".encode("latin-1"))
    out.extend(b"0000000000 65535 f \n")
    for num in range(1, total):
        out.extend(f"{offsets[num]:010d} 00000 n \n".encode("latin-1"))
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%SZ")
    out.extend(
        (
            f"trailer\n<< /Size {total} /Root 1 0 R "
            f"/Info << /Title (Resume) /CreationDate (D:{stamp}) >> >>\n"
            f"startxref\n{xref_at}\n%%EOF\n"
        ).encode("latin-1")
    )

    with open(path, "wb") as f:
        f.write(bytes(out))

    return n_pages


if __name__ == "__main__":
    docx_path = os.path.join(OUT_DIR, "RESUME_ATS.docx")
    pdf_path = os.path.join(OUT_DIR, "RESUME_ATS.pdf")
    build_docx(docx_path)
    n = build_pdf(pdf_path)
    print(f"wrote {docx_path} ({os.path.getsize(docx_path)} bytes)")
    print(f"wrote {pdf_path} ({os.path.getsize(pdf_path)} bytes, {n} page(s))")
