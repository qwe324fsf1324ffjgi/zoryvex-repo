/**
 * Hands the browser a file to save, in the way that actually works
 * everywhere.
 *
 * Two details are load-bearing and both were missing from the data-export
 * path, which is the one place a candidate exercises a legal right and the
 * worst place for a download to silently not happen:
 *
 * - The anchor is put in the document before it is clicked. A detached
 *   anchor works in Chrome and has never reliably worked in Firefox, where
 *   the click does nothing at all.
 * - The object URL is revoked on a later tick rather than immediately after
 *   `click()`. Revoking synchronously can cancel the download that click
 *   just started, because the browser has not finished reading the blob.
 *   The Kit download on the employer role page already got this right, with
 *   a comment saying why; the export did not.
 */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';

  document.body.appendChild(link);
  link.click();
  link.remove();

  // Generous, because the read is the browser's to schedule and a leaked
  // object URL for a few seconds costs nothing next to a download that
  // never arrives.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** The export is JSON, pretty-printed, because a person may well open it. */
export function downloadJson(filename: string, data: unknown): void {
  downloadBlob(filename, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
}
