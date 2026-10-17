import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@simplewebauthn/server', () => ({
  verifyAuthenticationResponse: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  generateRegistrationOptions: vi.fn(),
}));

import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { finishStepUp, type WebAuthnDependencies } from '../src/domain/webauthn-service';
import { UnauthorizedError } from '../src/errors/typed-errors';

const EMAIL = 'founder@example.com';
const SESSION_ID = 'plaintext-session-id';
const PEPPER = 'unit-test-pepper';
const NOW = new Date('2026-08-19T00:00:00.000Z');

function createFakes(input: { challenge?: string | null } = {}) {
  const markSteppedUpCalls: Array<{ sessionIdHash: string; verifiedAt: string }> = [];
  const updateCounterCalls: Array<{ email: string; credentialId: string; counter: number }> = [];

  const deps: WebAuthnDependencies = {
    rpId: 'test.zoryvex.space',
    rpName: 'Zoryvex',
    expectedOrigin: 'https://test.zoryvex.space',
    clock: { now: () => NOW },
    async listCredentials() {
      return [
        {
          credentialId: 'cred_1',
          publicKey: Buffer.from('key').toString('base64url'),
          counter: 0,
          createdAt: NOW.toISOString(),
        },
      ];
    },
    async saveCredential() {},
    async updateCredentialCounter(email, credentialId, counter) {
      updateCounterCalls.push({ email, credentialId, counter });
    },
    async putChallenge() {},
    async consumeChallenge() {
      return input.challenge === undefined ? 'the-challenge' : input.challenge;
    },
    async getAuthTokenPepper() {
      return PEPPER;
    },
    async markSessionSteppedUp(sessionIdHash, verifiedAt) {
      markSteppedUpCalls.push({ sessionIdHash, verifiedAt });
    },
  };

  return { deps, markSteppedUpCalls, updateCounterCalls };
}

describe('finishStepUp', () => {
  beforeEach(() => {
    vi.mocked(verifyAuthenticationResponse).mockReset();
  });

  it('throws UnauthorizedError when the step-up challenge is missing/expired, without verifying anything', async () => {
    const { deps } = createFakes({ challenge: null });
    await expect(finishStepUp(EMAIL, { id: 'cred_1' } as never, SESSION_ID, deps)).rejects.toThrow(
      UnauthorizedError,
    );
    expect(verifyAuthenticationResponse).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedError for an unknown credential id, without verifying anything', async () => {
    const { deps } = createFakes();
    await expect(
      finishStepUp(EMAIL, { id: 'cred_unknown' } as never, SESSION_ID, deps),
    ).rejects.toThrow(UnauthorizedError);
    expect(verifyAuthenticationResponse).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedError and never marks the session stepped-up when verification fails', async () => {
    vi.mocked(verifyAuthenticationResponse).mockResolvedValue({ verified: false } as never);
    const { deps, markSteppedUpCalls } = createFakes();
    await expect(finishStepUp(EMAIL, { id: 'cred_1' } as never, SESSION_ID, deps)).rejects.toThrow(
      UnauthorizedError,
    );
    expect(markSteppedUpCalls).toHaveLength(0);
  });

  it('updates the credential counter and marks exactly this session stepped-up on success', async () => {
    vi.mocked(verifyAuthenticationResponse).mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 7 },
    } as never);
    const { deps, markSteppedUpCalls, updateCounterCalls } = createFakes();

    await finishStepUp(EMAIL, { id: 'cred_1' } as never, SESSION_ID, deps);

    expect(updateCounterCalls).toEqual([{ email: EMAIL, credentialId: 'cred_1', counter: 7 }]);
    expect(markSteppedUpCalls).toHaveLength(1);
    expect(markSteppedUpCalls[0]!.verifiedAt).toBe(NOW.toISOString());
    // sessionIdHash must be derived from the session id + pepper, never the raw session id.
    expect(markSteppedUpCalls[0]!.sessionIdHash).not.toBe(SESSION_ID);
  });
});
