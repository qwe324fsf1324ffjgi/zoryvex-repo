import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { AppError } from '../errors/typed-errors';

export function jsonResponse(
  statusCode: number,
  body: unknown,
  cookies?: string[],
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(cookies && cookies.length > 0 ? { cookies } : {}),
  };
}

interface HttpResult {
  readonly __httpResult: true;
  readonly statusCode?: number;
  readonly body: unknown;
  readonly cookies?: string[];
  /** When set, `body` is used verbatim (never JSON.stringified) with this content-type. */
  readonly raw?: { contentType: string; headers?: Record<string, string> };
}

/**
 * Escape hatch for handlers that need a non-200 status or Set-Cookie headers
 * (session issuance/sign-out) without every plain domain function having to
 * know about API Gateway response shapes.
 */
export function httpResult(input: Omit<HttpResult, '__httpResult'>): HttpResult {
  return { __httpResult: true, ...input };
}

function isHttpResult(value: unknown): value is HttpResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Partial<HttpResult>).__httpResult === true
  );
}

/**
 * Thin adapter: maps a domain function's result/typed error onto an API
 * Gateway HTTP API response. Domain code never imports aws-lambda types.
 */
export async function toHttpResponse(
  run: () => Promise<unknown> | unknown,
): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const result = await run();
    if (isHttpResult(result)) {
      if (result.raw) {
        return {
          statusCode: result.statusCode ?? 200,
          headers: { 'content-type': result.raw.contentType, ...result.raw.headers },
          body: String(result.body),
          ...(result.cookies && result.cookies.length > 0 ? { cookies: result.cookies } : {}),
        };
      }
      return jsonResponse(result.statusCode ?? 200, result.body, result.cookies);
    }
    return jsonResponse(200, result);
  } catch (error) {
    if (error instanceof AppError) {
      return jsonResponse(error.statusCode, { error: error.code, message: error.message });
    }
    // Never the request body/email/token (docs/PRIVACY_AND_RETENTION.md's
    // "never logged" list) — only the exception's own name/message/stack,
    // the minimum needed to actually explain an unexpected failure.
    // Previously silently swallowed with zero trace, which made a real
    // Phase 7 slice 11 acceptance failure impossible to diagnose from
    // CloudWatch alone.
    const safeError =
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { name: 'UnknownError', message: String(error) };
    console.error('Unhandled error in request handler', safeError);
    return jsonResponse(500, { error: 'INTERNAL_ERROR', message: 'Unexpected error' });
  }
}
