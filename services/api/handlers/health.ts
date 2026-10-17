import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { toHttpResponse } from '../src/adapter/http';
import { getHealthStatus } from '../src/domain/health-service';
import { SystemClock } from '../src/repositories/clock-repository';

const clock = new SystemClock();

/**
 * ZORYVEX_BUILD_SHA is substituted by esbuild at bundle time
 * (scripts/build-lambda.mjs), so it identifies this exact bundle and cannot
 * drift from the code that is running. ZORYVEX_ENVIRONMENT is a real runtime
 * variable set by Terraform, because one bundle must stay deployable to more
 * than one environment.
 */
const build = {
  version: process.env.ZORYVEX_BUILD_SHA ?? 'unknown',
  environment: process.env.ZORYVEX_ENVIRONMENT ?? 'unknown',
};

export const handler: APIGatewayProxyHandlerV2 = async () =>
  toHttpResponse(() => getHealthStatus(clock, build));
