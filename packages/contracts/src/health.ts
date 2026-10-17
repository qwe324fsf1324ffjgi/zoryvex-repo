import { z } from 'zod';

export const HealthStatusSchema = z.object({
  status: z.literal('ok'),
  timestamp: z.string().datetime(),
  /**
   * The git commit the running bundle was built from, baked in at build
   * time by scripts/build-lambda.mjs rather than read from configuration.
   *
   * This exists so a deploy can prove what it deployed. The smoke test used
   * to assert only that /health answered 2xx, which the PREVIOUS deployment
   * also does — so a deploy that silently changed nothing was
   * indistinguishable from one that worked. Comparing this against the
   * commit being deployed is what makes that distinguishable.
   *
   * 'unknown' when the code is running unbundled (tests, local dev).
   */
  version: z.string().min(1),
  /** Which environment answered, from the Lambda's own configuration. */
  environment: z.string().min(1),
});

export type HealthStatus = z.infer<typeof HealthStatusSchema>;
