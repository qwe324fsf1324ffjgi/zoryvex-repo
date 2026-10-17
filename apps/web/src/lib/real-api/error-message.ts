import { RealApiError } from './client';

/**
 * The two refusals API Gateway writes itself.
 *
 * Every other 4xx in this system comes from an `AppError` the application
 * authored for a person to read. These two do not: the authorizer denies a
 * request before any handler runs, and API Gateway answers with a single
 * word. "Unauthorized" is a status name, not a sentence, and it tells
 * somebody whose session has just expired neither what happened nor what to
 * do about it.
 */
const GATEWAY_REFUSALS: Record<number, { generic: string; replacement: string }> = {
  401: {
    generic: 'Unauthorized',
    replacement: 'Your session has expired. Sign in again to continue.',
  },
  403: {
    generic: 'Forbidden',
    replacement: 'You do not have access to that. Sign in with the right account and try again.',
  },
};

/**
 * What to show a person when a real API call fails.
 *
 * The server already words its refusals for a human: "This role already has
 * a paid Kit", "This candidate has not consented to contact sharing", "Your
 * subscription needs a working card before contact details open again".
 * Replacing those with a generic "Try again" throws away the only sentence
 * that says what actually happened, and tells the reader to repeat an action
 * that cannot succeed.
 *
 * So a 4xx keeps the server's own message and a 5xx or a network failure
 * uses the caller's fallback: a 4xx is a statement about this request that
 * will be true again next time, and a 5xx is a statement about a bad moment
 * that a retry might get past.
 *
 * The exception is the pair above, and only when the message is the exact
 * word API Gateway generates. The application's own 401s are specific and
 * worth keeping - the sign-in step says "Invalid or expired code", which is
 * more useful than anything a blanket rule could substitute - so matching on
 * the exact generic string keeps those intact and rewrites only the ones
 * nobody wrote.
 *
 * Safe by construction. Only `AppError` messages reach a client at all
 * (services/api/src/adapter/http.ts); an unexpected server error returns a
 * fixed generic string, so this can never surface an internal detail.
 */
export function messageFor(error: unknown, fallback: string): string {
  if (error instanceof RealApiError && error.status >= 400 && error.status < 500 && error.message) {
    const gateway = GATEWAY_REFUSALS[error.status];
    if (gateway && error.message === gateway.generic) return gateway.replacement;
    return error.message;
  }
  return fallback;
}

/**
 * Whether this failure means the person is no longer signed in.
 *
 * Separate from the message because some callers should do more than show
 * one: a page whose whole content requires a session has nothing useful to
 * render behind the toast.
 */
export function isSignedOut(error: unknown): boolean {
  return error instanceof RealApiError && (error.status === 401 || error.status === 403);
}
