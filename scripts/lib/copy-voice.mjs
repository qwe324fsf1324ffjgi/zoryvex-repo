// Enforces the voice rules CLAUDE.md calls a standing bar.
//
// That section says the product "must read and look like it was made by a
// careful human product team, never like an AI wrote or designed it", and
// that this is "a standing bar, not a one-time cleanup — apply it to every
// new page, string, or component, not just at review time."
//
// Nothing enforced it. It held because whoever was writing happened to
// remember, which is the same shape as every other drift this project has
// found in itself: a rule that is true right up until the session where
// nobody thinks about it.
//
// Scoped to text a user can actually read. Code comments are exempt and are
// stripped before anything is checked: this file's own prose is full of the
// punctuation it bans elsewhere, and a rule about how the product speaks has
// no business policing how the source explains itself.

/** Verbatim from CLAUDE.md's list, plus the shapes it describes in words. */
export const BANNED_VOCABULARY = [
  'seamless',
  'leverage',
  'empower',
  'unlock your potential',
  'elevate',
  'cutting-edge',
  'revolutionize',
  'dive into',
  'unleash',
  'robust solution',
  'tailored to your needs',
  'state-of-the-art',
  'holistic',
  'frictionless',
  'supercharge',
  'effortless',
  'world-class',
  'best-in-class',
  'game-changer',
  "it's important to note",
];

/**
 * Removes every kind of comment this codebase writes, so a rule about
 * product copy never fires on an explanation of the code.
 *
 * Order matters: JSX comment braces wrap a block comment, so they go first.
 *
 * Every removed comment is replaced by its own newlines rather than by a
 * space, so line numbers survive. The first version collapsed multi-line
 * comments to one character and then reported violations against the
 * shifted line numbers, which pointed at innocent lines several lines away.
 * A checker that names the wrong line is worse than no checker: it costs the
 * reader their trust in it on the first false lead.
 */
const blankOut = (match) => match.replace(/[^\n]/g, ' ');

export function stripComments(source) {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, blankOut)
    .replace(/\/\*[\s\S]*?\*\//g, blankOut)
    .replace(/^(\s*)\/\/.*$/gm, '$1');
}

/**
 * Text a reader sees: JSX text nodes, and the string literals this codebase
 * uses to hold copy.
 *
 * Deliberately not a parser. A parser would be more correct and would need a
 * dependency, and the shapes here are narrow enough that a miss costs a
 * missed warning rather than a false one.
 */
export function visibleText(source) {
  const stripped = stripComments(source);
  const segments = [];

  // JSX text between tags, e.g. <p>Everything here</p>. Skips anything that
  // is only an expression, since `{formatNGN(x)}` is not prose.
  for (const match of stripped.matchAll(/>([^<>{}]+)</g)) {
    const text = match[1].trim();
    if (text.length > 1) segments.push(text);
  }

  // Quoted copy: JSX string attributes and plain string literals. Import
  // specifiers and className values are noise but harmless, since neither
  // can contain banned prose.
  for (const match of stripped.matchAll(/'([^'\\\n]{4,})'|"([^"\\\n]{4,})"|`([^`\\$]{4,})`/g)) {
    segments.push((match[1] ?? match[2] ?? match[3]).trim());
  }

  return segments;
}

/**
 * The exemption CLAUDE.md actually grants: "`<title>` tags and short compact
 * labels ('Page — Site', 'Item — price') are a normal, unrelated web
 * convention and don't need to change."
 *
 * So the rule is about prose, not about the character. A short heading of the
 * shape `Proof Hiring Kit — NGN 95,000` is the exempted case verbatim; the
 * same character inside a sentence in a paragraph is the tell the rule aims
 * at. The length bound is what stops the heading exemption swallowing the
 * rule, because a heading long enough to be a sentence is a sentence.
 */
const COMPACT_LABEL_MAX = 70;

/**
 * Line numbers of every short heading, so a compact label spread across
 * several lines is exempt too.
 *
 * JSX puts the tag and its text on separate lines as soon as the line gets
 * long, which is exactly when a heading holds a price. A same-line-only match
 * exempted `Step 1 — prove the account is yours` and flagged
 * `Proof Hiring Kit — NGN 95,000`, which is the example CLAUDE.md names as
 * fine.
 */
function exemptHeadingLines(source) {
  const exempt = new Set();
  for (const match of source.matchAll(/<(h[1-4])\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    // Expressions are not prose: `{formatNGN(x)}` renders as a short value.
    const text = match[2].replace(/\{[^}]*\}/g, '').trim();
    if (text.length > COMPACT_LABEL_MAX) continue;

    const startLine = source.slice(0, match.index).split('\n').length;
    const lineCount = match[0].split('\n').length;
    for (let i = 0; i < lineCount; i += 1) exempt.add(startLine + i);
  }
  return exempt;
}

function isExemptTitleLine(line) {
  return /\btitle\s*[:=]/.test(line) || /metadata\s*[:=]/.test(line);
}

export function findVoiceViolations(source, { file = '' } = {}) {
  const violations = [];
  const stripped = stripComments(source);
  const lines = stripped.split('\n');

  for (const [index, line] of lines.entries()) {
    const lower = line.toLowerCase();
    for (const word of BANNED_VOCABULARY) {
      if (lower.includes(word)) {
        violations.push({
          file,
          line: index + 1,
          kind: 'vocabulary',
          detail: `"${word}" is on CLAUDE.md's banned list. Say the concrete fact instead.`,
        });
      }
    }
  }

  // Em dashes, only where a reader meets them as prose.
  const headingLines = exemptHeadingLines(stripped);
  for (const [index, line] of lines.entries()) {
    if (!line.includes('—')) continue;
    if (isExemptTitleLine(line) || headingLines.has(index + 1)) continue;
    violations.push({
      file,
      line: index + 1,
      kind: 'em-dash',
      detail:
        'Em dash in visible prose. CLAUDE.md calls it the most recognizable AI-writing tell: ' +
        'use a period, comma or colon, or a middle dot for a compact metadata separator.',
    });
  }

  return violations;
}

export function describeVoiceViolations(violations) {
  if (violations.length === 0) return 'Product copy matches the voice rules in CLAUDE.md.';

  const lines = ['Copy that does not match CLAUDE.md’s voice rules:'];
  for (const v of violations) lines.push(`  ${v.file}:${v.line} ${v.detail}`);
  lines.push(
    '',
    'These are product-copy rules, not source-comment rules. Comments are stripped before checking.',
  );
  return lines.join('\n');
}
