import { getFeatureFlags } from '../repositories/feature-flags-repository';
import { SystemClock } from '../repositories/clock-repository';
import { getRole } from '../repositories/role-repository';
import {
  getKitOrderForRole,
  createKitOrderIfNotExists,
  getKitOrder,
  setKitOrderCheckoutUrl,
} from '../repositories/kit-order-repository';
import { createArtifact, getLatestArtifact } from '../repositories/kit-artifact-repository';
import { createPaymentAttemptIfNotExists } from '../repositories/billing-repository';
import { getEmployer } from '../repositories/employer-repository';
import { getPaystackSecretKey } from '../repositories/ssm-secure-repository';
import { initializePaystackTransaction } from '../lib/paystack-client';
import { NotFoundError } from '../errors/typed-errors';
import type { KitDependencies } from '../domain/kit-service';
import { requireEnv } from '../lib/require-env';

async function getEmployerEmail(employerId: string): Promise<string> {
  const employer = await getEmployer(employerId);
  if (!employer) throw new NotFoundError('Employer not found');
  return employer.contactEmail;
}

export function createAwsKitDependencies(): KitDependencies {
  return {
    clock: new SystemClock(),
    getFeatureFlags,
    getRole,
    getKitOrderForRole,
    createKitOrderIfNotExists,
    getKitOrder,
    setKitOrderCheckoutUrl,
    getLatestArtifact,
    createArtifact,
    createPaymentAttemptIfNotExists,
    getEmployerEmail,
    async initializeTransaction(input) {
      const secretKey = await getPaystackSecretKey();
      return initializePaystackTransaction(input, secretKey);
    },
    // Build-time NEXT_PUBLIC_API_BASE_URL exists for the frontend; the
    // Lambda side of this same "which environment am I" question is this
    // env var, set the same way PAYSTACK_SECRET_KEY_PARAM already is on
    // this route's Terraform module block.
    //
    // A getter rather than a plain read, so it throws where it is used
    // instead of at construction. Only requestKitOrder reads it, to build
    // the URL Paystack redirects the buyer back to; every other Kit route
    // and the webhook route construct these same dependencies and have no
    // business requiring the variable. It used to default to an empty
    // string, which would have handed Paystack a relative callback URL and
    // sent a buyer who had just paid somewhere that does not exist.
    get appOrigin() {
      return requireEnv('APP_ORIGIN');
    },
  };
}
