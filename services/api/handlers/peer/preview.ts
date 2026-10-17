import { z } from 'zod';
import { TEXT_LIMITS } from '@zoryvex/contracts';
import { toHttpResponse } from '../../src/adapter/http';
import { parseJsonBody } from '../../src/http/request';
import { validateRequest } from '../../src/validation/validate-request';
import { previewPeerRequest } from '../../src/domain/peer-request-service';
import {
  createAwsPeerAttestationDependencies,
  loadPeerAttestationPepper,
} from '../../src/composition/aws-peer-attestation-dependencies';

const PreviewSchema = z.object({ token: z.string().min(20).max(TEXT_LIMITS.token) }).strict();

const deps = createAwsPeerAttestationDependencies();

/**
 * What a verifier is being asked to confirm. Unauthenticated: the recipient
 * has no account and should never need one to answer a question about
 * somebody else's work.
 *
 * POST rather than GET, so the token travels in a body rather than a URL that
 * would land in access logs and browser history. Reads without spending, so
 * somebody can close the tab, think, and come back.
 */
export const handler = async (event: { body?: string | null }) =>
  toHttpResponse(async () => {
    await loadPeerAttestationPepper();
    const { token } = validateRequest(PreviewSchema, parseJsonBody(event.body));
    return previewPeerRequest(token, deps);
  });
