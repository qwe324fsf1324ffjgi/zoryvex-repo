import { ValidationError } from '../errors/typed-errors';

export function parseJsonBody(body: string | undefined | null): unknown {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new ValidationError('Request body must be valid JSON');
  }
}
