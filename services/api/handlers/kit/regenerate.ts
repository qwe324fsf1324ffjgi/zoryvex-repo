import { toHttpResponse } from '../../src/adapter/http';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { ForbiddenError, ValidationError } from '../../src/errors/typed-errors';
import { regenerateKitArtifact } from '../../src/domain/kit-service';
import { createAwsKitDependencies } from '../../src/composition/aws-kit-dependencies';

const deps = createAwsKitDependencies();

/** employer_admin only. Safe: always a new version, never overwrites the paid original. */
export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    const session = requireSessionContext(event);
    if (session.role !== 'employer_admin') throw new ForbiddenError('employer_admin only');
    if (!session.employerId) throw new ForbiddenError('employer_admin only');
    const roleId = event.pathParameters?.roleId;
    if (!roleId) throw new ValidationError('roleId is required');
    const artifact = await regenerateKitArtifact(session.employerId, roleId, deps);
    return { version: artifact.version, generatedAt: artifact.generatedAt };
  });
