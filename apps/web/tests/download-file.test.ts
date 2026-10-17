import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadBlob, downloadJson } from '../src/lib/download-file';

/**
 * The data export is the one place a candidate exercises a legal right, and
 * the worst place for a download to silently not happen. Two details decide
 * whether it does.
 */
describe('downloadBlob', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function stubObjectUrls() {
    const created = vi.fn().mockReturnValue('blob:fake');
    const revoked = vi.fn();
    // jsdom implements neither.
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: revoked });
    return { created, revoked };
  }

  it('puts the anchor in the document before clicking it', () => {
    stubObjectUrls();
    let inDocumentAtClick = false;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      // A detached anchor works in Chrome and has never reliably worked
      // in Firefox, where the click does nothing at all.
      inDocumentAtClick = document.body.contains(this);
    });

    downloadBlob('x.json', new Blob(['{}']));
    expect(click).toHaveBeenCalledOnce();
    expect(inDocumentAtClick).toBe(true);
  });

  it('cleans the anchor out again', () => {
    stubObjectUrls();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    downloadBlob('x.json', new Blob(['{}']));
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
  });

  it('sets the filename the caller asked for', () => {
    stubObjectUrls();
    let filename = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      filename = this.download;
    });
    downloadBlob('zoryvex-my-data.json', new Blob(['{}']));
    expect(filename).toBe('zoryvex-my-data.json');
  });

  /**
   * Revoking synchronously after `click()` can cancel the download that
   * click just started, because the browser has not finished reading the
   * blob yet.
   */
  it('does not revoke the object URL until well after the click', () => {
    vi.useFakeTimers();
    const { revoked } = stubObjectUrls();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    downloadBlob('x.json', new Blob(['{}']));
    expect(revoked).not.toHaveBeenCalled();

    vi.advanceTimersByTime(30_000);
    expect(revoked).toHaveBeenCalledWith('blob:fake');
  });
});

describe('downloadJson', () => {
  it('writes JSON a person can actually read', async () => {
    const captured: Blob[] = [];
    Object.assign(URL, {
      createObjectURL: (blob: Blob) => {
        captured.push(blob);
        return 'blob:fake';
      },
      revokeObjectURL: () => undefined,
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    downloadJson('x.json', { candidate: { id: 'c1' } });

    expect(captured[0]?.type).toBe('application/json');
    // Pretty-printed, because an export is opened by a person at least as
    // often as by a machine.
    await expect(captured[0]?.text()).resolves.toContain('\n  ');
    vi.restoreAllMocks();
  });
});
