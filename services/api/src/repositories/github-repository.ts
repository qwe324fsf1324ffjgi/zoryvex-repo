import { UpstreamUnavailableError } from '../domain/verification-service';
import { forgetGithubToken, getGithubToken } from './ssm-secure-repository';
import type { ContributorPayload, GistPayload, RepoPayload } from '../lib/verifiers/github-repo';

/**
 * The only place a GitHub URL is ever constructed, and it is always built
 * from this constant plus values the domain already parsed and validated. No
 * candidate-supplied string reaches fetch(), which is what keeps the
 * verification endpoint from being a server-side request forgery primitive
 * (these Lambdas are not VPC-attached, so they can reach the instance
 * metadata service).
 */
const GITHUB_API = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 5_000;

/**
 * Unauthenticated GitHub allows 60 requests an hour per IP, and one
 * verification spends three of them. That is genuinely reachable on a warm
 * Lambda, so a 403/429 is surfaced as UpstreamUnavailableError and never as a
 * failed check: telling a candidate their real work did not verify because we
 * ran out of quota would be both wrong and a good way to lose them.
 *
 * A fine-grained token with no scopes, read-only public data, raises this to
 * 5,000 an hour. It is optional on purpose so the feature works before that
 * parameter exists, and the 60/hour limit above was measured against the
 * live API on 2026-09-13 rather than taken from the documentation.
 *
 * The token is read from Parameter Store, not from a plain Lambda
 * environment variable. This file used to read `process.env.GITHUB_TOKEN`,
 * which no Terraform in either environment ever set, so every call has in
 * fact been unauthenticated.
 */
function baseHeaders(): Record<string, string> {
  return {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    // GitHub rejects requests with no user agent.
    'user-agent': 'zoryvex-verification',
  };
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getGithubToken();
  return token ? { ...baseHeaders(), authorization: `Bearer ${token}` } : baseHeaders();
}

async function send(path: string, headers: Record<string, string>): Promise<Response> {
  try {
    return await fetch(`${GITHUB_API}${path}`, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // A timeout or a network failure is not evidence about the candidate.
    throw new UpstreamUnavailableError(
      error instanceof Error ? error.message : 'GitHub request failed',
    );
  }
}

async function githubGet<T>(path: string): Promise<T | null> {
  let response = await send(path, await authHeaders());

  // A revoked or rotated token answers 401, and a warm execution context
  // would keep sending it until the container recycled. Dropping the cache
  // and retrying once without credentials degrades to the unauthenticated
  // behaviour this environment has always had, rather than failing every
  // verification until somebody notices.
  if (response.status === 401) {
    forgetGithubToken();
    console.error('GitHub rejected the configured token; retrying unauthenticated');
    response = await send(path, baseHeaders());
  }

  if (response.status === 404) return null;

  // 403 and 429 are both how GitHub reports rate limiting; 5xx is theirs too.
  if (response.status === 403 || response.status === 429 || response.status >= 500) {
    throw new UpstreamUnavailableError(`GitHub responded ${response.status}`);
  }
  if (!response.ok) {
    throw new UpstreamUnavailableError(`GitHub responded ${response.status}`);
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new UpstreamUnavailableError('GitHub returned a body that was not JSON');
  }
}

export async function fetchGist(gistId: string): Promise<GistPayload | null> {
  return githubGet<GistPayload>(`/gists/${encodeURIComponent(gistId)}`);
}

export async function fetchRepo(owner: string, repo: string): Promise<RepoPayload | null> {
  return githubGet<RepoPayload>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
}

/**
 * An empty contributor list is a legitimate answer (GitHub returns 204 for a
 * repository with no commits), and it correctly fails the authorship check
 * rather than erroring.
 */
export async function fetchRepoContributors(
  owner: string,
  repo: string,
): Promise<ContributorPayload[]> {
  const result = await githubGet<ContributorPayload[]>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contributors?per_page=100`,
  );
  return Array.isArray(result) ? result : [];
}
