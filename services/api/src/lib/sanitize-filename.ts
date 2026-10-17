/**
 * Original filenames are stored as private metadata only after this
 * sanitization (docs/DATA_MODEL.md's evidence-safety rules) — strips path
 * separators/control characters and caps length. Storage keys themselves
 * are always a randomized ID, never derived from this value.
 */
export function sanitizeFilename(rawFilename: string): string {
  const withoutPath = rawFilename.split(/[/\\]/).pop() ?? 'file';
  // eslint-disable-next-line no-control-regex
  const withoutControlChars = withoutPath.replace(/[\x00-\x1f\x7f]/g, '');
  const trimmed = withoutControlChars.trim();
  const safe = trimmed.length > 0 ? trimmed : 'file';
  return safe.slice(0, 255);
}
