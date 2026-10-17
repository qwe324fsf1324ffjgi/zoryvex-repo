import { describe, expect, it } from 'vitest';
import { fetchGist, fetchRepo, fetchRepoContributors } from '../src/repositories/github-repository';
import {
  parseGistUrl,
  parseRepoUrl,
  provenLoginFromGist,
  verifyRepository,
} from '../src/lib/verifiers/github-repo';

/**
 * The repository-ownership check, run against GitHub itself.
 *
 * Every other test of this code hands it a payload we wrote. That proves the
 * logic and proves nothing about the thing it is actually pointed at: whether
 * GitHub still returns `public`, `owner.login`, `files[].content`,
 * `files[].truncated`, `fork`, `size` and `contributions` in the shape these
 * functions read. A field GitHub renames does not fail a single mocked test,
 * and would fail every real candidate.
 *
 * So this suite makes real calls and asserts on real answers. It is opt-in
 * because CI must not go red when GitHub has an outage or when the runner's
 * IP is over the anonymous 60-an-hour limit. Neither of those is a fact about
 * this code, and a test that reports them as one trains people to ignore it.
 *
 *   ZORYVEX_LIVE_GITHUB=1 npm run test:live-github
 *
 * The fixtures are octocat's, chosen because they are a decade old and have
 * outlived every redesign GitHub has shipped since. Nothing here writes.
 */
const LIVE = process.env.ZORYVEX_LIVE_GITHUB === '1';

// A public gist created in 2014, one file, small enough that GitHub inlines
// the body rather than truncating it.
const GIST_ID = '6cad326836d38bd3a7ae';
const GIST_OWNER = 'octocat';
const REPO_OWNER = 'octocat';
const REPO_NAME = 'Hello-World';

describe.skipIf(!LIVE)('repository-ownership verification, against live GitHub', () => {
  it('reads a real public gist in the shape the verifier expects', async () => {
    const gist = await fetchGist(GIST_ID);

    expect(gist).not.toBeNull();
    // Each of these is a field the check makes a decision on. Asserting the
    // shape separately from the outcome means a GitHub rename is reported as
    // a rename rather than as "verification failed".
    expect(gist?.public).toBe(true);
    expect(gist?.owner?.login).toBe(GIST_OWNER);
    const files = Object.values(gist?.files ?? {});
    expect(files.length).toBeGreaterThan(0);
    expect(files[0]?.truncated).toBe(false);
    expect(typeof files[0]?.content).toBe('string');
  });

  it('proves the login when the gist contains the code, and refuses when it does not', async () => {
    const gist = await fetchGist(GIST_ID);
    expect(gist).not.toBeNull();

    // Stands in for the nonce. A real challenge code is random, and what the
    // check actually does is look for a specific string in the body, so a
    // string genuinely present in this gist exercises the same path.
    const presentInGist = 'class HelloWorld';
    const proven = provenLoginFromGist(gist!, presentInGist);
    expect(proven).toEqual({ login: GIST_OWNER });

    // The negative matters more than the positive: this is the branch that
    // stops somebody pointing at a gist they did not write.
    const absent = provenLoginFromGist(gist!, 'zoryvex-nonce-that-is-not-there-9f2b41');
    expect(absent).toEqual({
      reason: 'That gist does not contain the verification code Zoryvex gave you.',
    });
  });

  it('verifies a real public repository the proven account actually committed to', async () => {
    const repo = await fetchRepo(REPO_OWNER, REPO_NAME);
    const contributors = await fetchRepoContributors(REPO_OWNER, REPO_NAME);

    expect(repo).not.toBeNull();
    expect(repo?.fork).toBe(false);
    expect(repo?.private).toBe(false);

    const outcome = verifyRepository(repo!, contributors, GIST_OWNER);
    expect(outcome.verified).toBe(true);
    if (outcome.verified) {
      expect(outcome.facts.fullName).toBe(`${REPO_OWNER}/${REPO_NAME}`);
      expect(outcome.facts.contributions).toBeGreaterThan(0);
    }
  });

  it('refuses a repository the proven account does not own', async () => {
    const repo = await fetchRepo(REPO_OWNER, REPO_NAME);
    expect(repo).not.toBeNull();

    const outcome = verifyRepository(
      repo!,
      [{ login: 'somebody-else', contributions: 40 }],
      'somebody-else',
    );
    expect(outcome.verified).toBe(false);
  });

  it('returns null rather than throwing for a gist that does not exist', async () => {
    // 404 has to stay distinguishable from an outage: one is a message to the
    // candidate about their link, the other must never be reported as a
    // failed check.
    await expect(fetchGist('00000000000000000000000000000000')).resolves.toBeNull();
  });

  it('parses the URLs GitHub actually hands a candidate', async () => {
    const gist = await fetchGist(GIST_ID);
    const login = gist?.owner?.login ?? GIST_OWNER;

    // The address bar shows /<login>/<id> after creating a gist. The bare
    // /<id> form is what people get from the API or an older link.
    expect(parseGistUrl(`https://gist.github.com/${login}/${GIST_ID}`)).toBe(GIST_ID);
    expect(parseGistUrl(`https://gist.github.com/${GIST_ID}`)).toBe(GIST_ID);

    expect(parseRepoUrl(`https://github.com/${REPO_OWNER}/${REPO_NAME}`)).toEqual({
      owner: REPO_OWNER,
      repo: REPO_NAME,
    });
    // People paste the clone URL, so it is tolerated rather than rejected.
    expect(parseRepoUrl(`https://github.com/${REPO_OWNER}/${REPO_NAME}.git`)).toEqual({
      owner: REPO_OWNER,
      repo: REPO_NAME,
    });
  });
});
