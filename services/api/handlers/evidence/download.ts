import { toHttpResponse } from '../../src/adapter/http';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { ForbiddenError, ValidationError } from '../../src/errors/typed-errors';
import { authorizeAndPresignEvidenceDownload } from '../../src/domain/evidence-download-service';
import { createAwsEvidenceDownloadDependencies } from '../../src/composition/aws-evidence-dependencies';

const deps = createAwsEvidenceDownloadDependencies();

/**
 * candidate only, own files only — always resolves against the
 * authenticated session's own candidateId, never a client-suppliable one
 * (see src/domain/evidence-download-service.ts).
 */
export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    const session = requireSessionContext(event);
    if (session.role !== 'candidate' || !session.candidateId)
      throw new ForbiddenError('candidate only');
    const fileId = event.pathParameters?.fileId;
    if (!fileId) throw new ValidationError('fileId is required');
    return authorizeAndPresignEvidenceDownload(session.candidateId, fileId, deps);
  });
