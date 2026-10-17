import { toHttpResponse } from '../../src/adapter/http';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { ForbiddenError } from '../../src/errors/typed-errors';
import { exportCandidateData } from '../../src/domain/privacy-service';
import { createAwsPrivacyDependencies } from '../../src/composition/aws-privacy-dependencies';

const deps = createAwsPrivacyDependencies();

/** candidate only, own record only. Never includes a raw S3 key/URL. */
export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    const session = requireSessionContext(event);
    if (session.role !== 'candidate' || !session.candidateId)
      throw new ForbiddenError('candidate only');
    return exportCandidateData(session.candidateId, deps);
  });
