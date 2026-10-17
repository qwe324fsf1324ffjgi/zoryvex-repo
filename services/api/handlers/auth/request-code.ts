import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { z } from 'zod';
import { toHttpResponse } from '../../src/adapter/http';
import { parseJsonBody } from '../../src/http/request';
import { validateRequest } from '../../src/validation/validate-request';
import { requestSignInCode } from '../../src/domain/auth-service';
import { createAwsAuthDependencies } from '../../src/composition/aws-auth-dependencies';
import { ForbiddenError } from '../../src/errors/typed-errors';
import { originAllowed } from '../../src/http/csrf';

const RequestCodeSchema = z.object({
  email: z.string().email(),
  intendedRole: z.enum(['candidate', 'employer_admin']),
});

const deps = createAwsAuthDependencies();

export const handler: APIGatewayProxyHandlerV2 = async (event) =>
  toHttpResponse(async () => {
    const appOrigin = process.env.APP_ORIGIN;
    if (!appOrigin) throw new Error('APP_ORIGIN environment variable is not set');
    if (!originAllowed(event.headers.origin, appOrigin)) {
      throw new ForbiddenError('Origin not allowed');
    }

    const body = validateRequest(RequestCodeSchema, parseJsonBody(event.body));
    const sourceIp = event.requestContext.http.sourceIp;
    return requestSignInCode({ ...body, sourceIp, appOrigin }, deps);
  });
