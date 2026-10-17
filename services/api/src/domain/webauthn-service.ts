import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  WebAuthnCredential,
} from '@simplewebauthn/server';
import { UnauthorizedError } from '../errors/typed-errors';
import { hmacHash } from '../crypto/tokens';
import type { Clock } from '../repositories/clock-repository';

export interface StoredCredential {
  credentialId: string;
  publicKey: string; // base64url
  counter: number;
  transports?: string[] | undefined;
  createdAt: string;
}

/**
 * ADR 0001 founder/admin step-up: WebAuthn/passkey, with strict origin/RP-ID/
 * challenge-freshness/replay checks. Registration and step-up both require
 * an already-authenticated founder_admin session (enforced by the calling
 * handler, not here) — this module only does the WebAuthn ceremony itself.
 */
export interface WebAuthnDependencies {
  rpId: string;
  rpName: string;
  expectedOrigin: string;
  clock: Clock;
  listCredentials(email: string): Promise<StoredCredential[]>;
  saveCredential(email: string, record: StoredCredential): Promise<void>;
  updateCredentialCounter(email: string, credentialId: string, counter: number): Promise<void>;
  putChallenge(email: string, challenge: string, ttlEpochSeconds: number): Promise<void>;
  consumeChallenge(email: string): Promise<string | null>;
  getAuthTokenPepper(): Promise<string>;
  markSessionSteppedUp(sessionIdHash: string, verifiedAt: string): Promise<void>;
}

const CHALLENGE_TTL_SECONDS = 5 * 60;

/** Conditionally spreads `transports` so an absent value omits the key entirely (exactOptionalPropertyTypes). */
function withTransports(transports?: string[]): { transports?: AuthenticatorTransportFuture[] } {
  return transports ? { transports: transports as AuthenticatorTransportFuture[] } : {};
}

export async function beginRegistration(
  email: string,
  deps: WebAuthnDependencies,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const existing = await deps.listCredentials(email);
  const options = await generateRegistrationOptions({
    rpName: deps.rpName,
    rpID: deps.rpId,
    userName: email,
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({
      id: c.credentialId,
      ...withTransports(c.transports),
    })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
  });
  await deps.putChallenge(
    email,
    options.challenge,
    Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SECONDS,
  );
  return options;
}

export async function finishRegistration(
  email: string,
  response: RegistrationResponseJSON,
  deps: WebAuthnDependencies,
): Promise<void> {
  const challenge = await deps.consumeChallenge(email);
  if (!challenge) throw new UnauthorizedError('Registration challenge expired or missing');

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: deps.expectedOrigin,
    expectedRPID: deps.rpId,
    requireUserVerification: true,
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw new UnauthorizedError('Registration verification failed');
  }

  const { credential } = verification.registrationInfo;
  await deps.saveCredential(email, {
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter,
    createdAt: new Date().toISOString(),
    ...(credential.transports ? { transports: credential.transports } : {}),
  });
}

export async function beginStepUp(
  email: string,
  deps: WebAuthnDependencies,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const existing = await deps.listCredentials(email);
  if (existing.length === 0) throw new UnauthorizedError('No WebAuthn credential registered');

  const options = await generateAuthenticationOptions({
    rpID: deps.rpId,
    allowCredentials: existing.map((c) => ({
      id: c.credentialId,
      ...withTransports(c.transports),
    })),
    userVerification: 'required',
  });
  await deps.putChallenge(
    email,
    options.challenge,
    Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SECONDS,
  );
  return options;
}

export async function finishStepUp(
  email: string,
  response: AuthenticationResponseJSON,
  sessionId: string,
  deps: WebAuthnDependencies,
): Promise<void> {
  const challenge = await deps.consumeChallenge(email);
  if (!challenge) throw new UnauthorizedError('Step-up challenge expired or missing');

  const existing = await deps.listCredentials(email);
  const match = existing.find((c) => c.credentialId === response.id);
  if (!match) throw new UnauthorizedError('Unknown credential');

  const credential: WebAuthnCredential = {
    id: match.credentialId,
    publicKey: new Uint8Array(Buffer.from(match.publicKey, 'base64url')),
    counter: match.counter,
    ...withTransports(match.transports),
  };

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: deps.expectedOrigin,
    expectedRPID: deps.rpId,
    credential,
    requireUserVerification: true,
  });
  if (!verification.verified) throw new UnauthorizedError('Step-up verification failed');

  await deps.updateCredentialCounter(
    email,
    match.credentialId,
    verification.authenticationInfo.newCounter,
  );

  const pepper = await deps.getAuthTokenPepper();
  const sessionIdHash = hmacHash(pepper, sessionId);
  await deps.markSessionSteppedUp(sessionIdHash, deps.clock.now().toISOString());
}
