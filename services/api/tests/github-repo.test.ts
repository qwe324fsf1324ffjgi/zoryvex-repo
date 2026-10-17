import { describe, expect, it } from 'vitest';
import {
  provenLoginFromGist,
  parseGistUrl,
  parseRepoUrl,
  verifyRepository,
  type ContributorPayload,
  type GistPayload,
  type RepoPayload,
} from '../src/lib/verifiers/github-repo';

const LOGIN = 'a-candidate';
const NONCE = 'zoryvex-verify-9f2c4a1e';
const GIST_ID = 'a1b2c3d4e5f60718293a';

function gist(overrides: Partial<GistPayload> = {}): GistPayload {
  return {
    owner: { login: LOGIN },
    public: true,
    files: { 'zoryvex-verification.txt': { content: `${NONCE}\n` } },
    ...overrides,
  };
}

function repo(overrides: Partial<RepoPayload> = {}): RepoPayload {
  return {
    full_name: `${LOGIN}/landing-zone`,
    private: false,
    fork: false,
    archived: false,
    disabled: false,
    size: 512,
    created_at: '2025-02-01T00:00:00Z',
    pushed_at: '2026-08-01T00:00:00Z',
    owner: { login: LOGIN },
    ...overrides,
  };
}

const contributors: ContributorPayload[] = [
  { login: LOGIN, contributions: 84 },
  { login: 'someone-else', contributions: 3 },
];

describe('parseRepoUrl', () => {
  it('takes owner and repo out of a normal repository URL', () => {
    expect(parseRepoUrl('https://github.com/a-candidate/landing-zone')).toEqual({
      owner: 'a-candidate',
      repo: 'landing-zone',
    });
  });

  it('tolerates the things people actually paste', () => {
    expect(parseRepoUrl('https://github.com/a-candidate/landing-zone/')).toMatchObject({
      repo: 'landing-zone',
    });
    expect(parseRepoUrl('https://github.com/a-candidate/landing-zone.git')).toMatchObject({
      repo: 'landing-zone',
    });
    expect(parseRepoUrl('  https://www.github.com/a-candidate/repo.name_1  ')).toMatchObject({
      repo: 'repo.name_1',
    });
  });

  /**
   * Same reasoning as the badge verifier: these Lambdas are not VPC-attached,
   * so handing a candidate-supplied URL to an HTTP client would be a
   * server-side request forgery primitive, including against the instance
   * metadata service. Only owner/repo are parsed out; the string itself is
   * never fetched.
   */
  it('refuses anything that is not github.com', () => {
    expect(parseRepoUrl('https://evil.example.com/a/b')).toBeNull();
    expect(parseRepoUrl('https://github.com.evil.test/a/b')).toBeNull();
    expect(parseRepoUrl('https://notgithub.com/a/b')).toBeNull();
    expect(parseRepoUrl('http://169.254.169.254/latest/meta-data/')).toBeNull();
  });

  it('refuses plain http even on the right host', () => {
    expect(parseRepoUrl('http://github.com/a-candidate/landing-zone')).toBeNull();
  });

  it('refuses paths that are not owner/repo', () => {
    expect(parseRepoUrl('https://github.com/a-candidate')).toBeNull();
    expect(parseRepoUrl('https://github.com/a/b/tree/main/src')).toBeNull();
    expect(parseRepoUrl('https://github.com/a/..')).toBeNull();
    expect(parseRepoUrl('not a url')).toBeNull();
  });
});

describe('parseGistUrl', () => {
  it('accepts both gist URL shapes', () => {
    expect(parseGistUrl(`https://gist.github.com/${GIST_ID}`)).toBe(GIST_ID);
    expect(parseGistUrl(`https://gist.github.com/${LOGIN}/${GIST_ID}`)).toBe(GIST_ID);
  });

  it('refuses a host that is not gist.github.com', () => {
    expect(parseGistUrl(`https://github.com/${GIST_ID}`)).toBeNull();
    expect(parseGistUrl(`https://gist.github.com.evil.test/${GIST_ID}`)).toBeNull();
  });
});

describe('provenLoginFromGist', () => {
  it('returns the owning login when a public gist carries the nonce', () => {
    expect(provenLoginFromGist(gist(), NONCE)).toEqual({ login: LOGIN });
  });

  /**
   * The nonce is random, single-use, and known only to the candidate it was
   * issued to, so a gist containing it can only have been created by whoever
   * holds it. Naming an account is not controlling it; this is what makes
   * the difference.
   */
  it('proves the gist owner, so a stolen repo URL cannot borrow another identity', () => {
    const impersonator = gist({ owner: { login: 'impersonator' } });
    // The gist proves who published the nonce, and nothing more. Pointing at
    // someone else's repository afterwards fails the ownership check.
    expect(provenLoginFromGist(impersonator, NONCE)).toEqual({ login: 'impersonator' });
    expect(verifyRepository(repo(), contributors, 'impersonator')).toMatchObject({
      verified: false,
    });
  });

  it('refuses a secret gist, which nobody can independently check', () => {
    expect(provenLoginFromGist(gist({ public: false }), NONCE)).toMatchObject({
      reason: expect.stringContaining('secret'),
    });
  });

  it('refuses a gist that does not contain the nonce', () => {
    const wrong = gist({ files: { 'a.txt': { content: 'some other text' } } });
    expect(provenLoginFromGist(wrong, NONCE)).toMatchObject({ reason: expect.any(String) });
  });

  it('treats a truncated file as proof absent rather than proof present', () => {
    // Fail closed: never conclude a proof is there from a body GitHub
    // declined to actually return.
    const truncated = gist({ files: { 'big.txt': { content: NONCE, truncated: true } } });
    expect(provenLoginFromGist(truncated, NONCE)).toMatchObject({ reason: expect.any(String) });
  });

  it('handles a gist with no files, and one with no owner', () => {
    expect(provenLoginFromGist(gist({ files: {} }), NONCE)).toMatchObject({
      reason: expect.any(String),
    });
    expect(provenLoginFromGist(gist({ owner: undefined }), NONCE)).toMatchObject({
      reason: expect.any(String),
    });
  });
});

describe('verifyRepository', () => {
  it('verifies a public, owned, non-fork repository the candidate committed to', () => {
    const result = verifyRepository(repo(), contributors, LOGIN);
    expect(result.verified).toBe(true);
    expect(result).toMatchObject({
      facts: { fullName: `${LOGIN}/landing-zone`, contributions: 84 },
    });
  });

  it('refuses a fork, because the work started as someone else’s', () => {
    expect(verifyRepository(repo({ fork: true }), contributors, LOGIN)).toMatchObject({
      verified: false,
    });
  });

  it('refuses a private repository nobody can check', () => {
    expect(verifyRepository(repo({ private: true }), contributors, LOGIN)).toMatchObject({
      verified: false,
    });
  });

  it('refuses a repository owned by a different account', () => {
    const theirs = repo({ owner: { login: 'someone-else' } });
    expect(verifyRepository(theirs, contributors, LOGIN)).toMatchObject({ verified: false });
  });

  it('refuses an empty repository', () => {
    expect(verifyRepository(repo({ size: 0 }), contributors, LOGIN)).toMatchObject({
      verified: false,
    });
  });

  it('refuses a repository GitHub has disabled', () => {
    expect(verifyRepository(repo({ disabled: true }), contributors, LOGIN)).toMatchObject({
      verified: false,
    });
  });

  /**
   * Ownership is not authorship. A repository can be created by one account
   * and filled with somebody else's commits, so the candidate has to appear
   * among the contributors GitHub credits.
   */
  it('refuses a repository the candidate owns but never committed to', () => {
    const notTheirs: ContributorPayload[] = [{ login: 'ghostwriter', contributions: 200 }];
    expect(verifyRepository(repo(), notTheirs, LOGIN)).toMatchObject({ verified: false });
  });

  it('refuses when the contributor list is empty', () => {
    expect(verifyRepository(repo(), [], LOGIN)).toMatchObject({ verified: false });
  });

  it('reports facts for the employer rather than inventing a quality score', () => {
    // Deliberately no star/age/size threshold. Invented gates silently reject
    // real engineers; the employer makes the hiring call, not the verifier.
    const quiet = repo({ size: 4, created_at: '2026-08-20T00:00:00Z' });
    const result = verifyRepository(quiet, [{ login: LOGIN, contributions: 1 }], LOGIN);
    expect(result.verified).toBe(true);
    expect(result).toMatchObject({ facts: { sizeKb: 4, contributions: 1 } });
  });
});
