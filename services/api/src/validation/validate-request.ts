import type { z } from 'zod';
import { ValidationError } from '../errors/typed-errors';

export function validateRequest<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((issue) => issue.message).join('; '));
  }
  return result.data;
}
