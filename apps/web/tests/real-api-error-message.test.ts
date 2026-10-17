import { describe, expect, it } from 'vitest';
import { RealApiError } from '../src/lib/real-api/client';
import { isSignedOut, messageFor } from '../src/lib/real-api/error-message';

const FALLBACK = 'Try again in a moment.';

describe('messageFor', () => {
  /**
   * The server words its refusals for a human. Replacing them with a generic
   * "try again" throws away the only sentence that says what happened, and
   * tells the reader to repeat something that cannot succeed.
   */
  it.each([400, 401, 403, 404, 409, 429])('keeps the server sentence for a %i', (status) => {
    const error = new RealApiError(status, 'CONFLICT', 'This role already has a paid Kit');
    expect(messageFor(error, FALLBACK)).toBe('This role already has a paid Kit');
  });

  /**
   * A 5xx is a statement about a bad moment rather than about this request,
   * and the server deliberately returns a fixed generic string for one, so
   * there is nothing there worth showing.
   */
  it.each([500, 502, 503])('uses the fallback for a %i', (status) => {
    const error = new RealApiError(status, 'INTERNAL_ERROR', 'Unexpected error');
    expect(messageFor(error, FALLBACK)).toBe(FALLBACK);
  });

  it('uses the fallback for a network failure, which is not a RealApiError at all', () => {
    expect(messageFor(new TypeError('Failed to fetch'), FALLBACK)).toBe(FALLBACK);
    expect(messageFor(undefined, FALLBACK)).toBe(FALLBACK);
  });

  it('uses the fallback rather than showing an empty message', () => {
    expect(messageFor(new RealApiError(403, 'FORBIDDEN', ''), FALLBACK)).toBe(FALLBACK);
  });
});

/**
 * The one place the rule above does not hold. API Gateway's authorizer
 * denies a request before any handler runs, so the body is a single word
 * that nobody wrote for a reader: a person whose session has just expired
 * mid-form was shown "Unauthorized" and left to work out both what happened
 * and what to do next.
 */
describe('messageFor on a refusal API Gateway wrote itself', () => {
  it('turns the bare 401 into something a person can act on', () => {
    const error = new RealApiError(401, 'UNKNOWN_ERROR', 'Unauthorized');
    expect(messageFor(error, FALLBACK)).toBe(
      'Your session has expired. Sign in again to continue.',
    );
  });

  it('turns the bare 403 into something a person can act on', () => {
    const error = new RealApiError(403, 'UNKNOWN_ERROR', 'Forbidden');
    expect(messageFor(error, FALLBACK)).toContain('do not have access');
  });

  /**
   * The reason this matches the exact string rather than the status. The
   * application's own 401s are specific and more useful than any blanket
   * replacement - the sign-in step's "Invalid or expired code" tells the
   * reader exactly which of the two things went wrong.
   */
  it('leaves the application own 401 message alone', () => {
    const error = new RealApiError(401, 'UNAUTHORIZED', 'Invalid or expired code');
    expect(messageFor(error, FALLBACK)).toBe('Invalid or expired code');
  });

  it('leaves an application 403 message alone', () => {
    const error = new RealApiError(
      403,
      'FORBIDDEN',
      'This candidate has not consented to contact sharing',
    );
    expect(messageFor(error, FALLBACK)).toBe('This candidate has not consented to contact sharing');
  });

  it('does not rewrite a message that merely contains the generic word', () => {
    const error = new RealApiError(401, 'UNAUTHORIZED', 'Unauthorized for this organization');
    expect(messageFor(error, FALLBACK)).toBe('Unauthorized for this organization');
  });
});

describe('isSignedOut', () => {
  it('recognises both refusal codes', () => {
    expect(isSignedOut(new RealApiError(401, 'X', 'Unauthorized'))).toBe(true);
    expect(isSignedOut(new RealApiError(403, 'X', 'Forbidden'))).toBe(true);
  });

  it('is false for anything else, including a network failure', () => {
    expect(isSignedOut(new RealApiError(409, 'CONFLICT', 'Already paid'))).toBe(false);
    expect(isSignedOut(new RealApiError(500, 'X', 'boom'))).toBe(false);
    expect(isSignedOut(new TypeError('Failed to fetch'))).toBe(false);
  });
});
