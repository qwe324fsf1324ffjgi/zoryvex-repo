import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { validateRequest } from '../src/validation/validate-request';
import { ValidationError } from '../src/errors/typed-errors';

const schema = z.object({ id: z.string().min(1) });

describe('validateRequest', () => {
  it('returns the parsed value when valid', () => {
    expect(validateRequest(schema, { id: 'abc' })).toEqual({ id: 'abc' });
  });

  it('throws ValidationError when invalid', () => {
    expect(() => validateRequest(schema, { id: '' })).toThrow(ValidationError);
  });
});
