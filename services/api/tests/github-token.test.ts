import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { forgetGithubToken, getGithubToken } from '../src/repositories/ssm-secure-repository';
import { fetchRepo } from '../src/repositories/github-repository';

/**
 * The rate-limit credential for repository verification.
 *
 * `github-repository.ts` read `process.env.GITHUB_TOKEN`, and no Terraform in
 * either environment ever set it, so every GitHub call this product has ever
 * made has been unauthenticated. GitHub allows 60 of those an hour per IP,
 * measured against the live API on 2026-09-13, and one verification spends
 * three: about twenty verifications an hour for the whole platform, sharing a
 * Lambda egress address. It has not bitten because almost nobody has verified
 * yet. It becomes a wall the moment candidates arrive.
 *
 * The token now comes from Parameter Store instead. A value passed as a plain
 * Lambda environment variable is readable by anyone who can call
 * GetFunctionConfiguration, and this is a credential; every other secret here
 * already goes through SSM.
 *
 * The behaviour that matters most is that it is OPTIONAL. Absent, empty or
 * unreadable must all mean "carry on unauthenticated", because refusing to
 * verify a candidate's real work to protect a rate-limit optimisation would
 * break a working feature for no gain. That is the opposite of the Paystack
 * key beside it, which fails closed on purpose.
 */

const ssmMock = mockClient(SSMClient);

// Fixture only. Shaped like a GitHub fine-grained token and is not one.
const FIXTURE_TOKEN = ['github', 'pat', '11FIXTUREONLY0000000000'].join('_');
const PARAM = '/zoryvex/test/github/token';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('getGithubToken', () => {
  beforeEach(() => {
    ssmMock.reset();
    forgetGithubToken();
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN_PARAM;
  });

  afterEach(() => {
    forgetGithubToken();
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN_PARAM;
    vi.restoreAllMocks();
  });

  it('returns null when nothing is configured, which is production today', async () => {
    await expect(getGithubToken()).resolves.toBeNull();
    expect(ssmMock.calls()).toHaveLength(0);
  });

  it('reads the parameter with decryption when one is named', async () => {
    process.env.GITHUB_TOKEN_PARAM = PARAM;
    ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: FIXTURE_TOKEN } });

    await expect(getGithubToken()).resolves.toBe(FIXTURE_TOKEN);

    const call = ssmMock.commandCalls(GetParameterCommand)[0];
    expect(call!.args[0].input.Name).toBe(PARAM);
    expect(call!.args[0].input.WithDecryption).toBe(true);
  });

  it('treats the empty placeholder Terraform creates as no token', async () => {
    // The parameter is created empty and filled in by hand later, so an
    // empty string is the normal state in between and is not an error.
    process.env.GITHUB_TOKEN_PARAM = PARAM;
    ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: '' } });

    await expect(getGithubToken()).resolves.toBeNull();
  });

  it('carries on unauthenticated when the parameter cannot be read', async () => {
    // Fails soft on purpose. A missing IAM grant or a deleted parameter must
    // not stop a candidate verifying real work.
    process.env.GITHUB_TOKEN_PARAM = PARAM;
    ssmMock.on(GetParameterCommand).rejects(new Error('AccessDeniedException'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(getGithubToken()).resolves.toBeNull();
    expect(logged).toHaveBeenCalled();
  });

  it('never puts the token in what it logs', async () => {
    process.env.GITHUB_TOKEN_PARAM = PARAM;
    ssmMock.on(GetParameterCommand).rejects(new Error(`bad token ${FIXTURE_TOKEN}`));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await getGithubToken();

    // The error message itself carries the fixture, so a handler that logged
    // the whole error would leak a real credential here.
    expect(JSON.stringify(logged.mock.calls)).not.toContain(FIXTURE_TOKEN);
  });

  it('caches, so a warm container does not read the parameter every call', async () => {
    process.env.GITHUB_TOKEN_PARAM = PARAM;
    ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: FIXTURE_TOKEN } });

    await getGithubToken();
    await getGithubToken();

    expect(ssmMock.commandCalls(GetParameterCommand)).toHaveLength(1);
  });
});

describe('the GitHub adapter and its credential', () => {
  beforeEach(() => {
    ssmMock.reset();
    forgetGithubToken();
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN_PARAM;
  });

  afterEach(() => {
    forgetGithubToken();
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN_PARAM;
    vi.restoreAllMocks();
  });

  it('sends no authorization header when there is no token', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ full_name: 'octocat/hello' }));

    await fetchRepo('octocat', 'hello');

    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
    expect(headers['user-agent']).toBe('zoryvex-verification');
  });

  it('sends the token once it is configured', async () => {
    process.env.GITHUB_TOKEN_PARAM = PARAM;
    ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: FIXTURE_TOKEN } });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ full_name: 'octocat/hello' }));

    await fetchRepo('octocat', 'hello');

    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${FIXTURE_TOKEN}`);
  });

  it('falls back to unauthenticated when GitHub rejects the token', async () => {
    // A rotated or revoked token answers 401. A warm container would keep
    // sending it until it recycled, failing every verification in between.
    // Degrading to the unauthenticated behaviour this environment has always
    // had is strictly better than that.
    process.env.GITHUB_TOKEN_PARAM = PARAM;
    ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: FIXTURE_TOKEN } });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ message: 'Bad credentials' }, 401))
      .mockResolvedValueOnce(jsonResponse({ full_name: 'octocat/hello' }));

    const repo = await fetchRepo('octocat', 'hello');

    expect(repo).toEqual({ full_name: 'octocat/hello' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryHeaders = fetchMock.mock.calls[1]![1]!.headers as Record<string, string>;
    expect(retryHeaders.authorization).toBeUndefined();
  });

  it('re-reads the parameter after a rejection rather than reusing the dead token', async () => {
    // The retry above only helps once. Dropping the cache is what lets the
    // next call pick up a token the founder has since rotated.
    process.env.GITHUB_TOKEN_PARAM = PARAM;
    ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: FIXTURE_TOKEN } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Built fresh per call: a Response body can only be read once, so
    // handing back one shared instance makes the second read look like a
    // malformed body rather than a second request.
    let call = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      call += 1;
      return call === 1
        ? jsonResponse({ message: 'Bad credentials' }, 401)
        : jsonResponse({ full_name: 'octocat/hello' });
    });

    await fetchRepo('octocat', 'hello');
    await fetchRepo('octocat', 'hello');

    expect(ssmMock.commandCalls(GetParameterCommand).length).toBeGreaterThan(1);
  });

  it('still reports a real 404 as not found, not as a credential problem', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ message: 'Not Found' }, 404));

    await expect(fetchRepo('octocat', 'nope')).resolves.toBeNull();
  });
});
