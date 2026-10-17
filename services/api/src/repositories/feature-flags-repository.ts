import { GetParameterCommand, ParameterNotFound, SSMClient } from '@aws-sdk/client-ssm';
import { DEFAULT_FEATURE_FLAGS, FeatureFlagsSchema, type FeatureFlags } from '@zoryvex/config';

const ssm = new SSMClient({});

/**
 * `/zoryvex/<env>/feature-flags` (plain String, not SecureString — nothing
 * here is a secret): scripts/emergency-cost-lockdown.mjs's proposed
 * convention, confirmed here as the real read path. Deliberately NOT
 * cached (unlike the auth-token pepper): this is exactly the parameter an
 * incident-response `--restore`-less lockdown writes to, and a warm Lambda
 * serving a stale cached "on" value after a founder-triggered lockdown
 * would defeat the point of the lockdown script. Missing parameter or a
 * value that fails schema validation both fail closed to
 * DEFAULT_FEATURE_FLAGS (every flag false) rather than throwing — a
 * feature-flag read must never be the reason `aiMatching`/`contactUnlocks`
 * checks stop working.
 */
export async function getFeatureFlags(): Promise<FeatureFlags> {
  const paramName = process.env.FEATURE_FLAGS_PARAM;
  if (!paramName) return DEFAULT_FEATURE_FLAGS;

  try {
    const result = await ssm.send(new GetParameterCommand({ Name: paramName }));
    const raw = result.Parameter?.Value;
    if (!raw) return DEFAULT_FEATURE_FLAGS;

    const parsed = FeatureFlagsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_FEATURE_FLAGS;
  } catch (error) {
    if (error instanceof ParameterNotFound) return DEFAULT_FEATURE_FLAGS;
    if (error instanceof SyntaxError) return DEFAULT_FEATURE_FLAGS;
    throw error;
  }
}
