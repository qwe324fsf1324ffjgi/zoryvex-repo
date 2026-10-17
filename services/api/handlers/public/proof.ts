import { toHttpResponse } from '../../src/adapter/http';
import { ValidationError } from '../../src/errors/typed-errors';
import { getPublicProof } from '../../src/domain/public-proof-service';
import { createAwsPublicProofDependencies } from '../../src/composition/aws-public-proof-dependencies';

const deps = createAwsPublicProofDependencies();

/**
 * The public proof page's data. Unauthenticated on purpose: the opaque,
 * revocable id in the URL is the only credential, and a page nobody can read
 * without an account is not a page a candidate can carry anywhere.
 *
 * There is no candidate id, no session and no employer context in scope here,
 * so there is nothing this route could leak by getting authorization wrong.
 * The only decision it makes is whether that id resolves, and
 * `getPublicProof` answers every failure identically.
 */
export const handler = async (event: { pathParameters?: { publicProofId?: string } | null }) =>
  toHttpResponse(async () => {
    const publicProofId = event.pathParameters?.publicProofId;
    if (!publicProofId) throw new ValidationError('publicProofId is required');
    return getPublicProof(publicProofId, deps);
  });
