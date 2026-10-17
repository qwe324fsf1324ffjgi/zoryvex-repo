import { z } from 'zod';
import { PeerRelationshipSchema, TEXT_LIMITS } from '@zoryvex/contracts';
import { toHttpResponse } from '../../src/adapter/http';
import { parseJsonBody } from '../../src/http/request';
import { validateRequest } from '../../src/validation/validate-request';
import { confirmPeerAttestation } from '../../src/domain/peer-request-service';
import {
  createAwsPeerAttestationDependencies,
  loadPeerAttestationPepper,
} from '../../src/composition/aws-peer-attestation-dependencies';

const ConfirmSchema = z
  .object({
    token: z.string().min(20).max(TEXT_LIMITS.token),
    relationship: PeerRelationshipSchema,
    statement: z.string().min(1).max(600),
  })
  // .strict() matters more here than usual: it refuses a body carrying an
  // email address. The address comes from the stored request and accepting
  // one from whoever is posting would make the whole round trip decorative.
  .strict();

const deps = createAwsPeerAttestationDependencies();

/** Unauthenticated, single-use. The token is the only credential. */
export const handler = async (event: { body?: string | null }) =>
  toHttpResponse(async () => {
    await loadPeerAttestationPepper();
    const input = validateRequest(ConfirmSchema, parseJsonBody(event.body));
    const saved = await confirmPeerAttestation(input, deps);
    // Deliberately does not echo the record back. The verifier does not need
    // it, and it carries a hash that no read route should ever return.
    return { confirmed: true as const, evidenceId: saved.evidenceId };
  });
