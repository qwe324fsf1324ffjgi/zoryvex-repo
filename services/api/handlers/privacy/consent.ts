import { z } from 'zod';
import { toHttpResponse } from '../../src/adapter/http';
import { parseJsonBody } from '../../src/http/request';
import { validateRequest } from '../../src/validation/validate-request';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { ForbiddenError } from '../../src/errors/typed-errors';
import { updateConsent } from '../../src/domain/privacy-service';
import { createAwsPrivacyDependencies } from '../../src/composition/aws-privacy-dependencies';

const ConsentPatchSchema = z
  .object({
    discoveryOptIn: z.boolean().optional(),
    contactUnlockConsent: z.boolean().optional(),
    // The consent with the widest reach: the other two decide who inside the
    // product may see something, this one decides whether anybody at all can.
    // It goes through the same audited endpoint precisely so it is reviewed
    // alongside them rather than somewhere quieter.
    publicProof: z.boolean().optional(),
  })
  .strict();

const deps = createAwsPrivacyDependencies();

/** candidate only, own record only — always the authenticated session's own candidateId. */
export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    const session = requireSessionContext(event);
    if (session.role !== 'candidate' || !session.candidateId)
      throw new ForbiddenError('candidate only');
    const patch = validateRequest(ConsentPatchSchema, parseJsonBody(event.body));
    return updateConsent(session.candidateId, patch, deps);
  });
