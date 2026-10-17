import { z } from 'zod';
import { TEXT_LIMITS } from '@zoryvex/contracts';
import { toHttpResponse } from '../../src/adapter/http';
import { parseJsonBody } from '../../src/http/request';
import { validateRequest } from '../../src/validation/validate-request';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { ForbiddenError } from '../../src/errors/typed-errors';
import { requestEvidenceUpload } from '../../src/domain/evidence-upload-service';
import { createAwsEvidenceUploadDependencies } from '../../src/composition/aws-evidence-dependencies';

const RequestUploadSchema = z.object({
  fileName: z.string().min(1).max(TEXT_LIMITS.fileName),
  mimeType: z.string().min(1).max(TEXT_LIMITS.mimeType),
  sizeBytes: z.number().int().positive(),
});

const deps = createAwsEvidenceUploadDependencies();

/** candidate only — an employer never uploads on a candidate's behalf. */
export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    const session = requireSessionContext(event);
    if (session.role !== 'candidate' || !session.candidateId)
      throw new ForbiddenError('candidate only');
    const body = validateRequest(RequestUploadSchema, parseJsonBody(event.body));
    return requestEvidenceUpload(session.candidateId, body, deps);
  });
