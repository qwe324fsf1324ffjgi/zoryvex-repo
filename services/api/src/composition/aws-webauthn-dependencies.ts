import type { WebAuthnDependencies } from '../domain/webauthn-service';
import { SystemClock } from '../repositories/clock-repository';
import { getAuthTokenPepper } from '../repositories/ssm-secure-repository';
import { markSessionSteppedUp } from '../repositories/session-repository';
import {
  listCredentialsForAccount,
  saveCredential,
  updateCredentialCounter,
  putChallenge,
  consumeChallenge,
} from '../repositories/webauthn-credential-repository';

export function createAwsWebAuthnDependencies(): WebAuthnDependencies {
  const rpId = process.env.WEBAUTHN_RP_ID;
  const appOrigin = process.env.APP_ORIGIN;
  if (!rpId) throw new Error('WEBAUTHN_RP_ID environment variable is not set');
  if (!appOrigin) throw new Error('APP_ORIGIN environment variable is not set');

  return {
    rpId,
    rpName: 'Zoryvex',
    expectedOrigin: appOrigin,
    clock: new SystemClock(),
    listCredentials: listCredentialsForAccount,
    saveCredential,
    updateCredentialCounter,
    putChallenge,
    consumeChallenge,
    getAuthTokenPepper,
    markSessionSteppedUp,
  };
}
