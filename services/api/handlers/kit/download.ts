import { httpResult, toHttpResponse } from '../../src/adapter/http';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { ForbiddenError, ValidationError } from '../../src/errors/typed-errors';
import { getKitForDownload } from '../../src/domain/kit-service';
import { createAwsKitDependencies } from '../../src/composition/aws-kit-dependencies';

const deps = createAwsKitDependencies();

export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    const session = requireSessionContext(event);
    if (session.role !== 'employer_admin' && session.role !== 'employer_member') {
      throw new ForbiddenError('employer only');
    }
    if (!session.employerId) throw new ForbiddenError('employer only');
    const roleId = event.pathParameters?.roleId;
    if (!roleId) throw new ValidationError('roleId is required');

    const artifact = await getKitForDownload(session.employerId, roleId, deps);
    const download = event.queryStringParameters?.download === 'true';

    return httpResult({
      body: artifact.html,
      raw: {
        contentType: 'text/html; charset=utf-8',
        headers: {
          'content-disposition': download
            ? `attachment; filename="proof-hiring-kit-${roleId}-v${artifact.version}.html"`
            : 'inline',
        },
      },
    });
  });
