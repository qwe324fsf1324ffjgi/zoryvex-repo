import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpResult, toHttpResponse } from '../src/adapter/http';
import { ValidationError, NotFoundError } from '../src/errors/typed-errors';

describe('toHttpResponse', () => {
  it('returns 200 with the JSON-serialized result on success', async () => {
    const response = await toHttpResponse(() => ({ status: 'ok' }));
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body as string)).toEqual({ status: 'ok' });
  });

  it('maps a ValidationError to 400 with its error code', async () => {
    const response = await toHttpResponse(() => {
      throw new ValidationError('bad input');
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body as string)).toEqual({
      error: 'VALIDATION_ERROR',
      message: 'bad input',
    });
  });

  it('maps a NotFoundError to 404', async () => {
    const response = await toHttpResponse(() => {
      throw new NotFoundError('missing');
    });
    expect(response.statusCode).toBe(404);
  });

  it('maps an unknown error to 500 without leaking its message', async () => {
    const response = await toHttpResponse(() => {
      throw new Error('leaky internal detail');
    });
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body as string).message).toBe('Unexpected error');
  });

  describe('unhandled-error logging', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('logs the safe name/message/stack of an unexpected error, never the client-visible response alone', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await toHttpResponse(() => {
        throw new Error('leaky internal detail');
      });
      expect(spy).toHaveBeenCalledTimes(1);
      const [, safeError] = spy.mock.calls[0]!;
      expect(safeError).toMatchObject({ name: 'Error', message: 'leaky internal detail' });
      expect(safeError).toHaveProperty('stack');
    });

    it('logs a safe fallback shape for a thrown non-Error value', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await toHttpResponse(() => {
        throw 'a plain string throw';
      });
      expect(spy).toHaveBeenCalledTimes(1);
      const [, safeError] = spy.mock.calls[0]!;
      expect(safeError).toEqual({ name: 'UnknownError', message: 'a plain string throw' });
    });

    it('never logs anything for a typed AppError (expected control flow, not an unhandled failure)', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await toHttpResponse(() => {
        throw new ValidationError('bad input');
      });
      expect(spy).not.toHaveBeenCalled();
    });
  });

  it('returns a raw (non-JSON-stringified) body with a custom content-type', async () => {
    const response = await toHttpResponse(() =>
      httpResult({
        body: '<!doctype html><p>hi</p>',
        raw: { contentType: 'text/html', headers: { 'content-disposition': 'inline' } },
      }),
    );
    expect(response.statusCode).toBe(200);
    expect(response.headers?.['content-type']).toBe('text/html');
    expect(response.headers?.['content-disposition']).toBe('inline');
    expect(response.body).toBe('<!doctype html><p>hi</p>');
  });
});
