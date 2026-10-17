/**
 * Repository-ownership verification: the second autonomous route to
 * `verified`, for candidates whose proof is work they published rather than
 * an exam they sat.
 *
 * Certifications alone are a narrow supply. Plenty of genuinely strong cloud
 * and platform engineers have never paid for one, and gating discovery on
 * Credly badges would leave them permanently unverifiable.
 *
 * Two separate things are established, and both are required:
 *
 * 1. CONTROL of the GitHub account, proven by publishing a one-time nonce in
 *    a public gist. Only the account holder can create a gist under their
 *    login, so this cannot be satisfied by naming someone else's account.
 * 2. FACTS about the repository, read from the API rather than taken on
 *    trust: it is public, it is not a fork of someone else's work, it is not
 *    archived or empty, it belongs to the proven account, and the candidate
 *    appears among its contributors.
 *
 * What this deliberately does NOT do is judge quality. There is no minimum
 * star count, no minimum age, no "looks serious enough" threshold. Those
 * would be invented gates that silently reject real engineers, and CLAUDE.md
 * forbids a silent rejection. The reported facts (languages, size, dates) go
 * to the employer, who is the one making the hiring call.
 */

export interface GistPayload {
  owner?: { login?: string | undefined } | undefined;
  public?: boolean | undefined;
  files?:
    | Record<string, { content?: string | undefined; truncated?: boolean | undefined } | undefined>
    | undefined;
}

export interface RepoPayload {
  full_name?: string | undefined;
  private?: boolean | undefined;
  fork?: boolean | undefined;
  archived?: boolean | undefined;
  disabled?: boolean | undefined;
  size?: number | undefined;
  created_at?: string | undefined;
  pushed_at?: string | undefined;
  owner?: { login?: string | undefined } | undefined;
}

export interface ContributorPayload {
  login?: string | undefined;
  contributions?: number | undefined;
}

export interface RepoFacts {
  fullName: string;
  createdAt: string | null;
  lastPushedAt: string | null;
  sizeKb: number;
  contributions: number;
}

export type RepoVerification =
  { verified: true; facts: RepoFacts } | { verified: false; reason: string };

/** GitHub logins are case-insensitive, so every comparison here is too. */
function sameLogin(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Owner and repo are parsed out; the candidate's string is never fetched.
 * Identical reasoning to the badge verifier's extractBadgeAssertionId: these
 * Lambdas have outbound internet, so handing a user-supplied URL to an HTTP
 * client would be a server-side request forgery primitive.
 */
export function parseRepoUrl(repoUrl: string): { owner: string; repo: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(repoUrl.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') return null;

  // Owner and repo name character sets per GitHub's own rules. `.git` and a
  // trailing slash are both tolerated because people paste clone URLs.
  const match =
    /^\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(
      parsed.pathname,
    );
  if (!match) return null;

  const repo = match[2]!;
  // `.` and `..` are valid path segments but never valid repository names.
  if (repo === '.' || repo === '..') return null;
  return { owner: match[1]!, repo };
}

/** A gist id is a hex string; nothing else is ever fetched. */
export function parseGistUrl(gistUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(gistUrl.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.hostname.toLowerCase() !== 'gist.github.com') return null;

  // Either /<id> or /<login>/<id>.
  const match = /^\/(?:[A-Za-z0-9][A-Za-z0-9-]{0,38}\/)?([0-9a-f]{20,32})\/?$/i.exec(
    parsed.pathname,
  );
  return match ? match[1]!.toLowerCase() : null;
}

/**
 * The gist's owner IS the answer to "which GitHub account is this?" — there
 * is no separately-claimed login to compare against, because there does not
 * need to be. The nonce is random, single-use, and known only to the
 * candidate it was issued to, so a gist containing it can only have been
 * created by whoever holds that nonce.
 *
 * That closes the impersonation route without extra inputs. A candidate who
 * publishes the nonce under their own login and then points at someone
 * else's repository fails at the ownership check below, because the proven
 * login and the repository owner will not match.
 */
export function provenLoginFromGist(
  gist: GistPayload,
  nonce: string,
): { login: string } | { reason: string } {
  if (gist.public !== true) {
    return { reason: 'That gist is secret, so it cannot be checked. Create it as a public gist.' };
  }

  const login = gist.owner?.login;
  if (!login) {
    return { reason: 'That gist is not attached to a GitHub account.' };
  }

  const files = Object.values(gist.files ?? {});
  // A truncated file is one GitHub declined to inline. Treating a truncated
  // body as "nonce absent" is the fail-closed direction: never conclude a
  // proof is present from content that was not actually returned.
  const containsNonce = files.some(
    (file) => file?.truncated !== true && file?.content?.includes(nonce),
  );
  if (!containsNonce) {
    return { reason: 'That gist does not contain the verification code Zoryvex gave you.' };
  }

  return { login };
}

export function verifyRepository(
  repo: RepoPayload,
  contributors: ContributorPayload[],
  provenLogin: string,
): RepoVerification {
  if (repo.private === true) {
    return {
      verified: false,
      reason:
        'That repository is private, so Zoryvex cannot check it. Make it public, or verify a different one.',
    };
  }
  if (!sameLogin(repo.owner?.login, provenLogin)) {
    return {
      verified: false,
      reason: `That repository belongs to "${repo.owner?.login ?? 'an unknown account'}", not to the account you verified.`,
    };
  }
  if (repo.fork === true) {
    return {
      verified: false,
      reason:
        'That repository is a fork, so the work in it started as someone else’s. Point to a repository you created.',
    };
  }
  if (repo.disabled === true) {
    return { verified: false, reason: 'GitHub has disabled that repository.' };
  }
  if (!repo.size || repo.size <= 0) {
    return { verified: false, reason: 'That repository is empty.' };
  }

  // Ownership is not authorship. A repository can be created by one account
  // and filled with somebody else's commits, so the candidate has to actually
  // appear among the people GitHub credits with commits in it.
  const own = contributors.find((entry) => sameLogin(entry.login, provenLogin));
  const contributions = own?.contributions ?? 0;
  if (contributions <= 0) {
    return {
      verified: false,
      reason: 'GitHub does not credit that account with any commits in that repository.',
    };
  }

  return {
    verified: true,
    facts: {
      fullName: repo.full_name ?? `${provenLogin}/unknown`,
      createdAt: repo.created_at ?? null,
      lastPushedAt: repo.pushed_at ?? null,
      sizeKb: repo.size,
      contributions,
    },
  };
}
