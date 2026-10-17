import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { toHttpResponse } from '../../src/adapter/http';
import { processPaystackWebhook } from '../../src/domain/paystack-webhook-service';
import { createAwsPaystackWebhookDependencies } from '../../src/composition/aws-billing-dependencies';
import { getPaystackSecretKey } from '../../src/repositories/ssm-secure-repository';

const deps = createAwsPaystackWebhookDependencies();

/**
 * Unauthenticated by design — Paystack calls this directly, no session
 * exists. Authenticity comes entirely from the HMAC-SHA512 signature
 * check against the raw body (src/lib/paystack-signature.ts), never from
 * the REQUEST authorizer.
 *
 * The signature must be computed over the exact bytes Paystack sent, so
 * the base64 branch below matters: API Gateway may deliver the body
 * base64-encoded, and hashing the encoded form would fail every genuine
 * webhook while still failing every forged one, which looks identical
 * from the outside.
 *
 * A 2xx here tells Paystack the event is accepted and stops its retries.
 * That is why a processing failure deliberately throws rather than
 * swallowing: the retry schedule (every three minutes for four attempts,
 * then hourly for seventy-two hours) is the recovery path, and answering
 * 200 on a failure throws it away.
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) =>
  toHttpResponse(async () => {
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
      : (event.body ?? '');
    const secretKey = await getPaystackSecretKey();

    const outcome = await processPaystackWebhook(
      { rawBody, signatureHeader: event.headers['x-paystack-signature'], secretKey },
      deps,
    );

    return { received: true, ...outcome };
  });
