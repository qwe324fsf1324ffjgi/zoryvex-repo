import { z } from 'zod';
import { toHttpResponse } from '../../src/adapter/http';
import { parseJsonBody } from '../../src/http/request';
import { validateRequest } from '../../src/validation/validate-request';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { ForbiddenError, ValidationError } from '../../src/errors/typed-errors';
import { requestPeerAttestation } from '../../src/domain/peer-request-service';
import {
  createAwsPeerAttestationDependencies,
  loadPeerAttestationPepper,
} from '../../src/composition/aws-peer-attestation-dependencies';

const RequestSchema = z.object({ verifierEmail: z.string().email() }).strict();

const deps = createAwsPeerAttestationDependencies();

/** candidate only, own evidence only. The one authenticated route in this flow. */
export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    await loadPeerAttestationPepper();
    const session = requireSessionContext(event);
    if (session.role !== 'candidate' || !session.candidateId) {
      throw new ForbiddenError('candidate only');
    }
    const evidenceId = event.pathParameters?.evidenceId;
    if (!evidenceId) throw new ValidationError('evidenceId is required');

    const { verifierEmail } = validateRequest(RequestSchema, parseJsonBody(event.body));
    const appOrigin = process.env.APP_ORIGIN;
    if (!appOrigin) throw new Error('APP_ORIGIN environment variable is not set');

    return requestPeerAttestation(
      { candidateId: session.candidateId, evidenceId, verifierEmail, appOrigin },
      deps,
    );
  });
