#!/usr/bin/env python3
"""Render growth markdown documents to PDF with no third-party dependencies.

Same reasoning as careers/build_resume.py: no reportlab, pandoc or LibreOffice
is installed, and adding a dependency was not in scope. The PDF is written
directly using the base-14 fonts (Helvetica, Helvetica-Bold, Helvetica-Oblique,
Courier) so nothing has to be embedded and the text stays selectable and
extractable.

Supports the markdown these documents actually use: headings, paragraphs,
bullet and numbered lists, blockquotes, tables, horizontal rules, fenced code,
inline bold and inline code.

Usage:
    python growth/build_pdfs.py
"""

import os
import re
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "pdf")

DOCUMENTS = [
    (os.path.join(HERE, "OUTREACH", "README.md"), "OUTREACH.pdf", "Outreach"),
    (os.path.join(HERE, "POSTS", "LINKEDIN.md"), "LINKEDIN_POSTS.pdf", "LinkedIn posts"),
]

# --------------------------------------------------------------------------
# Page geometry (A4, in points)
# --------------------------------------------------------------------------

PAGE_W, PAGE_H = 595.28, 841.89
MARGIN_X, MARGIN_TOP, MARGIN_BOT = 64.0, 64.0, 56.0
CONTENT_W = PAGE_W - 2 * MARGIN_X

BODY = 10.0
LEAD = 14.0                                  # body line height

# --------------------------------------------------------------------------
# Base-14 font metrics (AFM advance widths, units per 1000)
# --------------------------------------------------------------------------

_HELV = {
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

_HELV_BOLD = {
    ' ': 278, '!': 333, '"': 474, '#': 556, '$': 556, '%': 889, '&': 722, "'": 238,
    '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
    '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556,
    '8': 556, '9': 556, ':': 333, ';': 333, '<': 584, '=': 584, '>': 584, '?': 611,
    '@': 975, 'A': 722, 'B': 722, 'C': 722, 'D': 722, 'E': 667, 'F': 611, 'G': 778,
    'H': 722, 'I': 278, 'J': 556, 'K': 722, 'L': 611, 'M': 833, 'N': 722, 'O': 778,
    'P': 667, 'Q': 778, 'R': 722, 'S': 667, 'T': 611, 'U': 722, 'V': 667, 'W': 944,
    'X': 667, 'Y': 667, 'Z': 611, '[': 333, '\\': 278, ']': 333, '^': 584, '_': 556,
    '`': 333, 'a': 556, 'b': 611, 'c': 556, 'd': 611, 'e': 556, 'f': 333, 'g': 611,
    'h': 611, 'i': 278, 'j': 278, 'k': 556, 'l': 278, 'm': 889, 'n': 611, 'o': 611,
    'p': 611, 'q': 611, 'r': 389, 's': 556, 't': 333, 'u': 611, 'v': 556, 'w': 778,
    'x': 556, 'y': 556, 'z': 500, '{': 389, '|': 280, '}': 389, '~': 584,
}

# Font keys: R regular, B bold, I oblique, C courier
_METRICS = {"R": _HELV, "B": _HELV_BOLD, "I": _HELV, "C": None}
_PDF_FONT = {"R": "F1", "B": "F2", "I": "F3", "C": "F4"}


def char_width(ch, font):
    if font == "C":
        return 600
    table = _METRICS[font]
    return table.get(ch, 556)


def text_width(s, size, font):
    return sum(char_width(c, font) for c in s) * size / 1000.0


# --------------------------------------------------------------------------
# Text encoding
# --------------------------------------------------------------------------

# WinAnsiEncoding is cp1252. Anything outside it has to be transliterated
# rather than silently dropped, or the reader gets a hole in a sentence.
_TRANSLIT = {
    "₦": "NGN ",   # naira sign, not in cp1252
    "✓": "yes",
    "✗": "no",
    "→": "->",
    "←": "<-",
    "⇒": "=>",
    "≤": "<=",
    "≥": ">=",
    " ": " ",
    " ": " ",
    "​": "",
}

_unencodable = set()


def to_cp1252(s):
    for src, dst in _TRANSLIT.items():
        s = s.replace(src, dst)
    out = bytearray()
    for ch in s:
        try:
            out.extend(ch.encode("cp1252"))
        except UnicodeEncodeError:
            _unencodable.add(ch)
            out.extend(b"?")
    return bytes(out)


def pdf_escape(raw):
    return raw.replace(b"\\", b"\\\\").replace(b"(", rb"\(").replace(b")", rb"\)")


# --------------------------------------------------------------------------
# Markdown parsing
# --------------------------------------------------------------------------

def parse_markdown(text):
    """Return a list of block tuples."""
    lines = text.replace("\r\n", "\n").split("\n")
    blocks, i = [], 0

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if not stripped:
            i += 1
            continue

        # fenced code
        if stripped.startswith("```"):
            i += 1
            buf = []
            while i < len(lines) and not lines[i].strip().startswith("```"):
                buf.append(lines[i])
                i += 1
            i += 1
            blocks.append(("code", buf))
            continue

        # horizontal rule
        if re.fullmatch(r"-{3,}|\*{3,}|_{3,}", stripped):
            blocks.append(("hr",))
            i += 1
            continue

        # heading
        m = re.match(r"^(#{1,6})\s+(.*)$", stripped)
        if m:
            blocks.append(("h%d" % len(m.group(1)), m.group(2).strip()))
            i += 1
            continue

        # table: a pipe row followed by a separator row
        if stripped.startswith("|") and i + 1 < len(lines) and \
                re.match(r"^\s*\|[\s:|-]+\|\s*$", lines[i + 1]):
            rows = []
            header = [c.strip() for c in stripped.strip("|").split("|")]
            rows.append(header)
            i += 2
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
                i += 1
            blocks.append(("table", rows))
            continue

        # blockquote: consume the whole run, keeping internal blank lines
        if stripped.startswith(">"):
            buf = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                buf.append(re.sub(r"^\s*>\s?", "", lines[i]).rstrip())
                i += 1
            paras, cur = [], []
            for b in buf:
                if b.strip():
                    cur.append(b.strip())
                elif cur:
                    paras.append(" ".join(cur))
                    cur = []
            if cur:
                paras.append(" ".join(cur))
            blocks.append(("quote", paras))
            continue

        # bullet list item (may wrap onto continuation lines)
        m = re.match(r"^(\s*)[-*+]\s+(.*)$", line)
        if m:
            depth = 1 if len(m.group(1)) >= 2 else 0
            buf = [m.group(2).strip()]
            i += 1
            while i < len(lines) and lines[i].strip() and \
                    not re.match(r"^\s*([-*+]|\d+\.|#|>|\||```)", lines[i]):
                buf.append(lines[i].strip())
                i += 1
            blocks.append(("bullet", depth, " ".join(buf)))
            continue

        # numbered list item
        m = re.match(r"^\s*(\d+)\.\s+(.*)$", line)
        if m:
            buf = [m.group(2).strip()]
            i += 1
            while i < len(lines) and lines[i].strip() and \
                    not re.match(r"^\s*([-*+]|\d+\.|#|>|\||```)", lines[i]):
                buf.append(lines[i].strip())
                i += 1
            blocks.append(("num", m.group(1), " ".join(buf)))
            continue

        # paragraph
        buf = [stripped]
        i += 1
        while i < len(lines) and lines[i].strip() and \
                not re.match(r"^\s*([-*+]|\d+\.|#|>|\||```|-{3,})", lines[i]):
            buf.append(lines[i].strip())
            i += 1
        blocks.append(("p", " ".join(buf)))

    return blocks


def inline_tokens(s, base="R"):
    """Split inline markdown into (word, font) tokens, preserving bold/code."""
    # Links: keep the label, drop the target. A PDF of a checklist does not
    # need the URL inline, and it wrecks the wrapping.
    s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1", s)

    segments, pos = [], 0
    pattern = re.compile(r"(\*\*(.+?)\*\*|`([^`]+)`|\*(.+?)\*)", re.S)
    for m in pattern.finditer(s):
        if m.start() > pos:
            segments.append((s[pos:m.start()], base))
        if m.group(2) is not None:
            segments.append((m.group(2), "B"))
        elif m.group(3) is not None:
            segments.append((m.group(3), "C"))
        else:
            segments.append((m.group(4), "I" if base == "R" else base))
        pos = m.end()
    if pos < len(s):
        segments.append((s[pos:], base))

    tokens = []
    for txt, font in segments:
        for w in txt.split():
            tokens.append((w, font))
    return tokens


def wrap_tokens(tokens, size, avail):
    """Greedy wrap of (word, font) tokens. Returns a list of token lines."""
    lines, cur, cur_w = [], [], 0.0
    for word, font in tokens:
        w = text_width(word, size, font)
        space = text_width(" ", size, font) if cur else 0.0
        if cur and cur_w + space + w > avail:
            lines.append(cur)
            cur, cur_w = [(word, font)], w
        else:
            cur.append((word, font))
            cur_w += space + w
    if cur:
        lines.append(cur)
    return lines or [[]]


# --------------------------------------------------------------------------
# Rendering
# --------------------------------------------------------------------------

class Renderer:
    def __init__(self, title):
        self.title = title
        self.pages = []
        self.ops = bytearray()
        self.y = PAGE_H - MARGIN_TOP
        self.page_no = 1
        self._page_header()

    # -- page plumbing ----------------------------------------------------
    def _page_header(self):
        self.text_line(self.title.upper(), PAGE_H - 40, MARGIN_X, 7.5, "R", gray=0.45)
        self.rule(PAGE_H - 50, MARGIN_X, MARGIN_X + CONTENT_W, gray=0.80)

    def _page_footer(self):
        label = "%d" % self.page_no
        w = text_width(label, 8, "R")
        self.text_line(label, 34, MARGIN_X + CONTENT_W - w, 8, "R", gray=0.45)

    def newpage(self):
        self._page_footer()
        self.pages.append(bytes(self.ops))
        self.ops = bytearray()
        self.page_no += 1
        self.y = PAGE_H - MARGIN_TOP
        self._page_header()

    def need(self, height):
        if self.y - height < MARGIN_BOT:
            self.newpage()

    def finish(self):
        self._page_footer()
        self.pages.append(bytes(self.ops))
        return self.pages

    # -- primitives -------------------------------------------------------
    def text_line(self, s, y, x, size, font, gray=0.0):
        raw = pdf_escape(to_cp1252(s))
        self.ops.extend(
            b"BT " + ("%.3f g " % gray).encode() +
            ("/%s %.2f Tf 1 0 0 1 %.2f %.2f Tm " % (_PDF_FONT[font], size, x, y)).encode() +
            b"(" + raw + b") Tj ET 0 g\n"
        )

    def token_line(self, tokens, y, x, size):
        cx = x
        for idx, (word, font) in enumerate(tokens):
            if idx:
                cx += text_width(" ", size, font)
            self.text_line(word, y, cx, size, font)
            cx += text_width(word, size, font)

    def rule(self, y, x0, x1, gray=0.0, width=0.5):
        self.ops.extend(
            ("%.3f G %.2f w %.2f %.2f m %.2f %.2f l S 0 G\n"
             % (gray, width, x0, y, x1, y)).encode()
        )

    def vrule(self, x, y0, y1, gray=0.55, width=1.5):
        self.ops.extend(
            ("%.3f G %.2f w %.2f %.2f m %.2f %.2f l S 0 G\n"
             % (gray, width, x, y0, x, y1)).encode()
        )

    # -- blocks -----------------------------------------------------------
    def paragraph(self, text, size=BODY, indent=0.0, lead=LEAD, gap=6.0,
                  base="R", prefix=None, prefix_font="R"):
        avail = CONTENT_W - indent
        lines = wrap_tokens(inline_tokens(text, base), size, avail)
        for n, ln in enumerate(lines):
            self.need(lead)
            self.y -= lead
            if n == 0 and prefix:
                self.text_line(prefix, self.y, MARGIN_X + indent - 14, size, prefix_font)
            self.token_line(ln, self.y, MARGIN_X + indent, size)
        self.y -= gap

    def heading(self, level, text):
        size = {1: 19.0, 2: 13.5, 3: 11.0}.get(level, 10.0)
        lead = size + 4
        space_before = {1: 4.0, 2: 16.0, 3: 12.0}.get(level, 10.0)
        self.y -= space_before
        # keep a heading with at least two lines of what follows
        self.need(lead + 2 * LEAD)
        lines = wrap_tokens(inline_tokens(text, "B"), size, CONTENT_W)
        for ln in lines:
            self.y -= lead
            self.token_line(ln, self.y, MARGIN_X, size)
        if level <= 2:
            self.y -= 5
            self.rule(self.y, MARGIN_X, MARGIN_X + CONTENT_W,
                      gray=0.0 if level == 1 else 0.75,
                      width=1.0 if level == 1 else 0.5)
        self.y -= 8

    def quote(self, paras):
        indent = 20.0
        size = BODY
        avail = CONTENT_W - indent - 8
        wrapped = [wrap_tokens(inline_tokens(p), size, avail) for p in paras]
        total = sum(len(w) for w in wrapped) * LEAD + (len(paras) - 1) * 5
        self.need(min(total, 3 * LEAD) + 8)
        self.y -= 4
        top = self.y
        seg_top = top
        for pi, lines in enumerate(wrapped):
            for ln in lines:
                if self.y - LEAD < MARGIN_BOT:
                    self.vrule(MARGIN_X + 6, self.y, seg_top)
                    self.newpage()
                    seg_top = self.y
                self.y -= LEAD
                self.token_line(ln, self.y, MARGIN_X + indent, size)
            if pi < len(wrapped) - 1:
                self.y -= 5
        self.vrule(MARGIN_X + 6, self.y - 2, seg_top)
        self.y -= 10

    def code(self, lines):
        size = 8.5
        lead = 11.0
        self.need(min(len(lines), 4) * lead + 10)
        self.y -= 4
        for raw in lines:
            if self.y - lead < MARGIN_BOT:
                self.newpage()
            self.y -= lead
            # hard-truncate rather than wrap: a broken command is worse than
            # a clipped one, because a clipped one is obviously clipped.
            s = raw
            while text_width(s, size, "C") > CONTENT_W - 12 and len(s) > 4:
                s = s[:-1]
            if s != raw:
                s = s[:-1] + "…"
            self.text_line(s, self.y, MARGIN_X + 10, size, "C", gray=0.15)
        self.y -= 10

    def table(self, rows):
        if not rows:
            return
        ncols = max(len(r) for r in rows)
        rows = [r + [""] * (ncols - len(r)) for r in rows]
        size = 9.0
        lead = 12.0
        pad = 5.0

        # column widths from natural content, clamped to the content box
        natural = []
        for c in range(ncols):
            w = max(text_width(re.sub(r"[*`]", "", r[c]), size,
                               "B" if i == 0 else "R")
                    for i, r in enumerate(rows))
            natural.append(w + 2 * pad)
        total = sum(natural)
        if total > CONTENT_W:
            scale = CONTENT_W / total
            widths = [w * scale for w in natural]
        else:
            extra = (CONTENT_W - total) / ncols
            widths = [w + extra for w in natural]

        self.y -= 6
        for ri, row in enumerate(rows):
            base = "B" if ri == 0 else "R"
            cells = [wrap_tokens(inline_tokens(row[c], base), size, widths[c] - 2 * pad)
                     for c in range(ncols)]
            height = max(len(c) for c in cells) * lead + 6

            if self.y - height < MARGIN_BOT:
                self.newpage()
                self.y -= 6

            top = self.y
            for c in range(ncols):
                x = MARGIN_X + sum(widths[:c]) + pad
                yy = top - 4
                for ln in cells[c]:
                    yy -= lead - 2
                    self.token_line(ln, yy, x, size)
            self.y = top - height
            self.rule(self.y + 2, MARGIN_X, MARGIN_X + CONTENT_W,
                      gray=0.0 if ri == 0 else 0.82,
                      width=0.8 if ri == 0 else 0.4)
        self.y -= 10

    def hr(self):
        self.need(14)
        self.y -= 7
        self.rule(self.y, MARGIN_X, MARGIN_X + CONTENT_W, gray=0.85)
        self.y -= 7


def render(blocks, title):
    r = Renderer(title)
    for b in blocks:
        kind = b[0]
        if kind.startswith("h") and kind[1:].isdigit():
            r.heading(int(kind[1:]), b[1])
        elif kind == "p":
            r.paragraph(b[1])
        elif kind == "bullet":
            indent = 16.0 + b[1] * 14.0
            r.paragraph(b[2], indent=indent, gap=3.0, prefix="•")
        elif kind == "num":
            r.paragraph(b[2], indent=22.0, gap=3.0, prefix=b[1] + ".", prefix_font="B")
        elif kind == "quote":
            r.quote(b[1])
        elif kind == "table":
            r.table(b[1])
        elif kind == "code":
            r.code(b[1])
        elif kind == "hr":
            r.hr()
    return r.finish()


# --------------------------------------------------------------------------
# PDF assembly
# --------------------------------------------------------------------------

def write_pdf(path, pages, title):
    n_pages = len(pages)
    first_content = 4 + n_pages

    kids = " ".join("%d 0 R" % (4 + i) for i in range(n_pages))
    objs = {
        1: "<< /Type /Catalog /Pages 2 0 R >>",
        2: "<< /Type /Pages /Kids [%s] /Count %d >>" % (kids, n_pages),
        3: ("<< /Font << "
            "/F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> "
            "/F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >> "
            "/F3 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >> "
            "/F4 << /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >> "
            ">> >>"),
    }
    for i in range(n_pages):
        objs[4 + i] = (
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.2f %.2f] "
            "/Resources 3 0 R /Contents %d 0 R >>" % (PAGE_W, PAGE_H, first_content + i)
        )

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = {}

    for num in sorted(objs):
        offsets[num] = len(out)
        out.extend(("%d 0 obj\n%s\nendobj\n" % (num, objs[num])).encode("latin-1"))

    for i, stream in enumerate(pages):
        num = first_content + i
        offsets[num] = len(out)
        out.extend(("%d 0 obj\n<< /Length %d >>\nstream\n" % (num, len(stream))).encode("latin-1"))
        out.extend(stream)
        out.extend(b"\nendstream\nendobj\n")

    total = first_content + n_pages
    xref_at = len(out)
    out.extend(("xref\n0 %d\n" % total).encode("latin-1"))
    out.extend(b"0000000000 65535 f \n")
    for num in range(1, total):
        out.extend(("%010d 00000 n \n" % offsets[num]).encode("latin-1"))

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%SZ")
    safe = pdf_escape(to_cp1252(title)).decode("latin-1")
    out.extend((
        "trailer\n<< /Size %d /Root 1 0 R /Info << /Title (%s) "
        "/Creator (Zoryvex growth/build_pdfs.py) /CreationDate (D:%s) >> >>\n"
        "startxref\n%d\n%%%%EOF\n" % (total, safe, stamp, xref_at)
    ).encode("latin-1"))

    with open(path, "wb") as f:
        f.write(bytes(out))
    return n_pages


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    for src, out_name, title in DOCUMENTS:
        with open(src, encoding="utf-8") as f:
            blocks = parse_markdown(f.read())
        pages = render(blocks, title)
        dest = os.path.join(OUT_DIR, out_name)
        n = write_pdf(dest, pages, title)
        print("%-22s %d page(s)  %d bytes  <- %s"
              % (out_name, n, os.path.getsize(dest), os.path.relpath(src, HERE)))
    if _unencodable:
        print("WARNING: characters replaced with '?': %r" % sorted(_unencodable))
