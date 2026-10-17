export abstract class AppError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: string;
}

export class ValidationError extends AppError {
  readonly statusCode = 400;
  readonly code = 'VALIDATION_ERROR';
}

export class NotFoundError extends AppError {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
}

export class UnauthorizedError extends AppError {
  readonly statusCode = 401;
  readonly code = 'UNAUTHORIZED';
}

export class ForbiddenError extends AppError {
  readonly statusCode = 403;
  readonly code = 'FORBIDDEN';
}

export class TooManyRequestsError extends AppError {
  readonly statusCode = 429;
  readonly code = 'TOO_MANY_REQUESTS';
}

export class ConflictError extends AppError {
  readonly statusCode = 409;
  readonly code = 'CONFLICT';
}

/** Paystack unreachable, or rejected a request we made to it — never our fault, never the caller's. */
export class PaymentProviderError extends AppError {
  readonly statusCode = 502;
  readonly code = 'PAYMENT_PROVIDER_ERROR';
}
