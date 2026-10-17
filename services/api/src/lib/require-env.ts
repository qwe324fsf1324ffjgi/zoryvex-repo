/**
 * An environment variable that must be set, read at the point of use.
 *
 * Composition modules read these lazily rather than at import time, so a
 * Lambda that never takes the code path does not fail to start over a
 * variable it does not need. Throwing rather than defaulting is deliberate:
 * a missing sender address or origin should stop the send, not produce mail
 * addressed to `undefined`.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} environment variable is not set`);
  return value;
}
