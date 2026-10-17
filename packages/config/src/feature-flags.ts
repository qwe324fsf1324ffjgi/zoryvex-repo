import { z } from 'zod';

/**
 * Shape only — values are read from AWS Parameter Store at runtime, never
 * hard-coded here. Every risky flag defaults to false when absent.
 */
export const FeatureFlagsSchema = z
  .object({
    payments: z.boolean().default(false),
    aiMatching: z.boolean().default(false),
    publicDiscovery: z.boolean().default(false),
    contactUnlocks: z.boolean().default(false),
    /**
     * Sends the single, one-per-candidate nudge to finish verification.
     * Off until deliberately switched on: it is the only thing in the system
     * that emails a person without them asking, so it should never start
     * because a deploy shipped.
     */
    verificationReminders: z.boolean().default(false),
  })
  .strict();

export type FeatureFlags = z.infer<typeof FeatureFlagsSchema>;

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  payments: false,
  aiMatching: false,
  publicDiscovery: false,
  contactUnlocks: false,
  verificationReminders: false,
};
