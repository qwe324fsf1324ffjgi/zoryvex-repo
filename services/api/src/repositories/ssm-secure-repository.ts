import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({});

/**
 * Cached per Lambda execution context (module-level — reused across warm
 * invocations, re-fetched on cold start). Never logged, never returned to a
 * caller, never included in any response body.
 */
let cachedAuthTokenPepper: string | undefined;

export async function getAuthTokenPepper(): Promise<string> {
  if (cachedAuthTokenPepper) return cachedAuthTokenPepper;
  const paramName = process.env.AUTH_TOKEN_PEPPER_PARAM;
  if (!paramName) throw new Error('AUTH_TOKEN_PEPPER_PARAM environment variable is not set');
  const result = await ssm.send(new GetParameterCommand({ Name: paramName, WithDecryption: true }));
  const value = result.Parameter?.Value;
  if (!value) throw new Error('Auth token pepper parameter has no value');
  cachedAuthTokenPepper = value;
  return cachedAuthTokenPepper;
}

/**
 * The prefix the key in this environment must have.
 *
 * The Paystack account is live-approved, which means a working `sk_live_`
 * key exists and can be pasted anywhere a key is asked for. The single most
 * expensive mistake available in this system is that key ending up in the
 * TEST environment's parameter, where every automated test, every demo
 * walkthrough and every reconciliation run would quietly move real money.
 *
 * Nothing in the code could have told the difference: the environment is
 * decided entirely by which key is configured, which is the right design
 * and is exactly why it needs a second opinion. Terraform sets this per
 * environment, so the two facts have to agree before a charge can happen.
 *
 * Absent means unchecked, so an environment that has not opted in behaves
 * as before rather than breaking.
 */
function expectedKeyPrefix(): string | null {
  const expected = process.env.PAYSTACK_KEY_PREFIX;
  return expected && expected.length > 0 ? expected : null;
}

/**
 * Deliberately NOT cached (unlike the pepper above): this is a founder-
 * replaced value (infrastructure/envs/test's aws_ssm_parameter.
 * paystack_secret_key placeholder-then-replace), and webhook calls are
 * infrequent enough that always fetching fresh avoids ever serving a
 * stale placeholder to a warm execution context after the founder
 * replaces it.
 */
export async function getPaystackSecretKey(): Promise<string> {
  const paramName = process.env.PAYSTACK_SECRET_KEY_PARAM;
  if (!paramName) throw new Error('PAYSTACK_SECRET_KEY_PARAM environment variable is not set');
  const result = await ssm.send(new GetParameterCommand({ Name: paramName, WithDecryption: true }));
  const value = result.Parameter?.Value;
  if (!value) throw new Error('Paystack secret key parameter has no value');

  const expected = expectedKeyPrefix();
  if (expected && !value.startsWith(expected)) {
    // The message names the prefixes and never the key. A thrown error is
    // the correct outcome: refusing every payment in this environment is
    // recoverable in one parameter write, and charging a real card in the
    // test environment is not.
    throw new Error(
      `Paystack key in ${paramName} does not start with ${expected}, which is what this ` +
        'environment is configured to accept. Refusing to use it.',
    );
  }

  return value;
}

/**
 * The GitHub token, if this environment has one. Never required.
 *
 * Unauthenticated GitHub allows 60 requests an hour per IP, measured
 * against the live API on 2026-09-13 and matching what the adapter's own
 * comment has always claimed. One repository verification spends three, so
 * the whole platform shares roughly twenty verifications an hour across a
 * shared Lambda egress address. Past that, real candidates are told GitHub
 * is unavailable. A token raises it to 5,000.
 *
 * Read from Parameter Store rather than passed as a plain Lambda
 * environment variable, which is what `github-repository.ts` did and what
 * no Terraform ever set. A value in a function's environment is readable by
 * anyone who can call GetFunctionConfiguration, and this is a credential.
 * Every other secret here already goes through SSM; this one was the
 * exception.
 *
 * Fails SOFT, which is the opposite of `getPaystackSecretKey` directly
 * above, and deliberately. Refusing to charge a card when the key looks
 * wrong is recoverable in one parameter write. Refusing to verify a
 * candidate's work because a rate-limit optimisation is unconfigured would
 * break a feature that works today, to protect nothing. Absent, empty, or
 * unreadable all mean "carry on unauthenticated", which is exactly the
 * behaviour in production right now.
 */
let cachedGithubToken: string | null | undefined;

export async function getGithubToken(): Promise<string | null> {
  if (cachedGithubToken !== undefined) return cachedGithubToken;

  // Local and script use, and the fallback that keeps this honest if the
  // parameter has not been created yet.
  const fromEnv = process.env.GITHUB_TOKEN;
  if (fromEnv && fromEnv.length > 0) {
    cachedGithubToken = fromEnv;
    return cachedGithubToken;
  }

  const paramName = process.env.GITHUB_TOKEN_PARAM;
  if (!paramName) {
    cachedGithubToken = null;
    return cachedGithubToken;
  }

  try {
    const result = await ssm.send(
      new GetParameterCommand({ Name: paramName, WithDecryption: true }),
    );
    const value = result.Parameter?.Value;
    // The parameter is created empty by Terraform and filled in by hand
    // later, so an empty string is the normal state before that happens and
    // is not an error.
    cachedGithubToken = value && value.length > 0 ? value : null;
  } catch (error) {
    // Never the candidate's problem, and never fatal. Logged without the
    // parameter's contents.
    console.error('Could not read the GitHub token parameter; continuing unauthenticated', {
      name: error instanceof Error ? error.name : 'UnknownError',
    });
    cachedGithubToken = null;
  }
  return cachedGithubToken;
}

/**
 * Drop the cached token so the next call fetches again.
 *
 * A token is cached for the life of a warm execution context. If the
 * founder rotates or revokes it, that container would keep sending the old
 * one and GitHub would answer 401 until the container recycled. The adapter
 * calls this on a 401 and retries once without credentials, so a rotated
 * token degrades to today's unauthenticated behaviour instead of failing
 * every verification.
 */
export function forgetGithubToken(): void {
  cachedGithubToken = undefined;
}
