import { httpResult, toHttpResponse } from '../../src/adapter/http';
import { ValidationError } from '../../src/errors/typed-errors';
import { getPublicProof } from '../../src/domain/public-proof-service';
import { renderProofBadge } from '../../src/domain/proof-badge';
import { createAwsPublicProofDependencies } from '../../src/composition/aws-public-proof-dependencies';

const deps = createAwsPublicProofDependencies();

/**
 * The carryable mark, as an SVG somebody can embed on a README or a personal
 * site. Unauthenticated for the same reason the page is: a badge that needed
 * an account to render is not a badge anybody can carry.
 *
 * Generated on every request from the same read the page uses, so the badge
 * and the page can never disagree. It is deliberately cached for a short
 * time rather than a long one: this thing exists to say when a proof was
 * last checked, and a CDN holding it for a day would make it assert a
 * freshness it does not have. Five minutes is long enough to survive a
 * README being crawled and short enough that a lapsed credential stops being
 * advertised the same morning.
 *
 * A revoked page makes this 404 rather than rendering an empty badge, so a
 * mark embedded on somebody else's site breaks visibly when consent is
 * withdrawn, which is what revocation has to mean.
 */
export const handler = async (event: { pathParameters?: { publicProofId?: string } | null }) =>
  toHttpResponse(async () => {
    const publicProofId = event.pathParameters?.publicProofId;
    if (!publicProofId) throw new ValidationError('publicProofId is required');

    const proof = await getPublicProof(publicProofId, deps);

    return httpResult({
      body: renderProofBadge(proof),
      raw: {
        contentType: 'image/svg+xml; charset=utf-8',
        headers: {
          'cache-control': 'public, max-age=300',
          // The badge is embedded by third parties by design, and it carries
          // no script and no external references. Saying so explicitly stops
          // a future edit quietly introducing one.
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
          'x-content-type-options': 'nosniff',
        },
      },
    });
  });
