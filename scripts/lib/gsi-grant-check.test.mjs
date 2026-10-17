import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  callGraphForModule,
  describeGsiFindings,
  grantedIndexesByBundle,
  gsiUsageByFunction,
  indexesUsedByHandler,
} from './gsi-grant-check.mjs';
import { auditEnvironment } from '../check-gsi-grants.mjs';

const root = join(import.meta.dirname, '..', '..');
const apiRoot = join(root, 'services', 'api');

/** In-memory file system, so the analysis can be tested on exact inputs. */
function fakeIo(files) {
  return {
    readFile: (path) => {
      if (!(path in files)) throw new Error(`no such file: ${path}`);
      return files[path];
    },
    exists: (path) => path in files,
  };
}

describe('gsiUsageByFunction', () => {
  it('attributes an index to the exported function that queries it', () => {
    const source = `
export async function getMatch(id) {
  return ddb.send(new GetCommand({ Key: { pk: id } }));
}

export async function listMatchesForCandidate(id) {
  return ddb.send(new QueryCommand({ IndexName: 'GSI1', KeyConditionExpression: 'x' }));
}`;
    const usage = gsiUsageByFunction(source);
    expect(usage.get('listMatchesForCandidate')).toEqual(['GSI1']);
    expect(usage.has('getMatch')).toBe(false);
  });
});

describe('callGraphForModule', () => {
  it('records what a handler calls from its exported handler', () => {
    const graph = callGraphForModule(`
import { updateConsent } from '../../src/domain/privacy-service';
export const handler = async (event) => toHttpResponse(() => updateConsent(id, patch, deps));`);
    expect([...graph.get('handler')]).toContain('updateConsent');
  });

  it('reads through deps.<name>, which is how a service reaches a repository', () => {
    const graph = callGraphForModule(`
export async function updateConsent(id, patch, deps) {
  await deps.listMatchesForCandidate(id);
}`);
    expect([...graph.get('updateConsent')]).toContain('listMatchesForCandidate');
  });

  it('does not read a dependencies interface as a call', () => {
    // `listMatchesForCandidate(candidateId: string): Promise<Match[]>` in an
    // interface body looks exactly like a call site to a naive matcher.
    const graph = callGraphForModule(`
export interface PrivacyDependencies {
  listMatchesForCandidate(candidateId: string): Promise<Match[]>;
}

export async function updateConsent(id, deps) {
  await deps.getCandidate(id);
}`);
    expect([...(graph.get('updateConsent') ?? [])]).not.toContain('listMatchesForCandidate');
  });

  it('does not let a type-only import swallow the rest of the file', () => {
    // The real bug this guards: an unanchored interface-stripping pattern
    // matched `type Candidate` inside the import list and deleted everything
    // after it, hiding a plain GSI call in the handler body.
    const graph = callGraphForModule(`
import { LaunchTrackSchema, type Candidate } from '@zoryvex/contracts';
export const handler = async () => {
  const found = await listDiscoveryOptedCandidates(track);
  return found;
};`);
    expect([...graph.get('handler')]).toContain('listDiscoveryOptedCandidates');
  });
});

describe('indexesUsedByHandler', () => {
  const fixtureRoot = resolve(root, '__gsi_fixture__');
  const repository = join(fixtureRoot, 'src', 'repositories', 'match-repository.ts');
  const service = join(fixtureRoot, 'src', 'domain', 'privacy-service.ts');

  const files = {
    [repository]: `
export async function getMatch(roleId, candidateId) { return ddb.send(new GetCommand({})); }

export async function listMatchesForCandidate(candidateId) {
  return ddb.send(new QueryCommand({ IndexName: 'GSI1' }));
}`,
    [service]: `
import { getMatch, listMatchesForCandidate } from '../repositories/match-repository';

export async function updateConsent(id, patch, deps) {
  if (!patch.discoveryOptIn) await withdrawFromOpenMatches(id, deps);
}

export async function readOneMatch(id, deps) {
  return deps.getMatch(id);
}

async function withdrawFromOpenMatches(id, deps) {
  return deps.listMatchesForCandidate(id);
}`,
  };

  it('follows a handler through a service into a GSI query', () => {
    const entry = join(fixtureRoot, 'handlers', 'privacy', 'consent.ts');
    const io = fakeIo({
      ...files,
      [entry]: `
import { updateConsent } from '../../src/domain/privacy-service';
export const handler = async (event) => updateConsent(id, patch, deps);`,
    });
    expect(indexesUsedByHandler(entry, io)).toEqual(['GSI1']);
  });

  it('does not claim an index a handler cannot reach, even from the same modules', () => {
    // This is the distinction that makes the check worth having. Both
    // handlers import the same service and the same repository; only one can
    // ever run the GSI query, and granting the other GSI1 anyway would widen
    // the policy for nothing.
    const entry = join(fixtureRoot, 'handlers', 'matches', 'get.ts');
    const io = fakeIo({
      ...files,
      [entry]: `
import { readOneMatch } from '../../src/domain/privacy-service';
export const handler = async (event) => readOneMatch(id, deps);`,
    });
    expect(indexesUsedByHandler(entry, io)).toEqual([]);
  });
});

describe('dependencies wired as an inline object method', () => {
  /**
   * The false negative that let a real outage through.
   *
   * A composition root wires most dependencies as a bare identifier, and the
   * walk handles those: the name maps straight to the repository function
   * holding the query. `hasMarketplaceEligibleRole` is wired as an inline
   * method instead, because it does a little work before delegating. It had
   * no node in the graph, so the walk arrived at the name from the domain
   * service, found no outgoing edges, and stopped one hop short of the GSI2
   * query underneath it.
   *
   * billing-create-subscription was therefore granted no index, and every
   * subscription checkout in TEST returned AccessDeniedException on GSI2
   * while this check reported the environment healthy. Found in CloudWatch
   * after the founder reported the buttons failing, not by any test.
   */
  const compositionRoot = `
import { listRolesByEmployer } from '../repositories/role-repository';

export function createAwsSubscriptionDependencies() {
  return {
    getBillingSubscription,
    async hasMarketplaceEligibleRole(employerId) {
      const roles = await listRolesByEmployer(employerId);
      return roles.length > 0;
    },
  };
}
`;

  it('gives an inline method its own edges', () => {
    const graph = callGraphForModule(compositionRoot);
    expect([...(graph.get('hasMarketplaceEligibleRole') ?? [])]).toContain('listRolesByEmployer');
  });

  it('keeps the enclosing declaration edges too', () => {
    // Additive on purpose. Moving the calls onto the method would trade this
    // false negative for another one wherever the enclosing function is
    // reachable and the method name is not.
    const graph = callGraphForModule(compositionRoot);
    expect([...(graph.get('createAwsSubscriptionDependencies') ?? [])]).toContain(
      'listRolesByEmployer',
    );
  });

  it('does not mistake control flow for a method definition', () => {
    const graph = callGraphForModule(`
export function run() {
  const items = [];
  if (items.length > 0) {
    queryTheIndex();
  }
  for (const x of items) {
    somethingElse();
  }
}
`);
    expect(graph.has('if')).toBe(false);
    expect(graph.has('for')).toBe(false);
  });

  it('reaches the GSI through an inline method end to end', () => {
    // Written across real lines, because the parser anchors declarations to
    // the start of one. A single-line fixture would pass or fail for reasons
    // that have nothing to do with the behaviour under test.
    const files = new Map([
      [
        '/h.ts',
        `import { createDeps } from './deps';
import { startCheckout } from './svc';

const deps = createDeps();

export async function handler() {
  return startCheckout(deps);
}
`,
      ],
      [
        '/svc.ts',
        `export async function startCheckout(deps) {
  return deps.hasMarketplaceEligibleRole('e');
}
`,
      ],
      [
        '/deps.ts',
        `import { listRolesByEmployer } from './repo';

export function createDeps() {
  return {
    async hasMarketplaceEligibleRole(id) {
      return listRolesByEmployer(id);
    },
  };
}
`,
      ],
      [
        '/repo.ts',
        `export async function listRolesByEmployer(id) {
  return query({ IndexName: 'GSI2' });
}
`,
      ],
    ]);
    // Basename only. Node's resolve() hands back a platform path, so this
    // splits on both separators without writing a backslash literal.
    const SEP = String.fromCharCode(92);
    const key = (f) => '/' + f.split('/').pop().split(SEP).pop();
    const io = {
      readFile: (f) => {
        const k = key(f);
        if (!files.has(k)) throw new Error('no such file');
        return files.get(k);
      },
      exists: (f) => files.has(key(f)),
    };
    // Without the inline-method node this returns [], which is exactly the
    // answer that left billing-create-subscription ungranted.
    expect(indexesUsedByHandler('/h.ts', io)).toEqual(['GSI2']);
  });
});

describe('grantedIndexesByBundle', () => {
  const source = `
module "privacy_consent_route" {
  source = "../../modules/api-route"

  function_name       = "zoryvex-test-privacy-consent"
  handler             = "handlers/privacy-consent.handler"
  dynamodb_table_arn  = module.core_table.table_arn
  dynamodb_index_arns = [local.core_table_gsi1_arn]
}

module "roles_get_route" {
  source = "../../modules/api-route"

  function_name      = "zoryvex-test-roles-get"
  handler            = "handlers/roles-get.handler"
  dynamodb_table_arn = module.core_table.table_arn
}

module "verification_reminder_job" {
  source = "../../modules/scheduled-job"

  function_name       = "zoryvex-test-verification-reminder"
  handler             = "handlers/jobs-verification-reminder.handler"
  dynamodb_index_arns = [local.core_table_gsi1_arn]
}`;

  it("keys grants by bundle name, so a block cannot be read as another block's", () => {
    const grants = grantedIndexesByBundle(source);
    expect(grants.get('privacy-consent')).toEqual(['GSI1']);
    expect(grants.get('roles-get')).toEqual([]);
  });

  it('follows the handler string, not the function name', () => {
    // The scheduled job's function is `zoryvex-test-verification-reminder`
    // while its bundle is `jobs-verification-reminder`. Matching on the
    // function name reported this one as having no module block at all.
    expect(grantedIndexesByBundle(source).get('jobs-verification-reminder')).toEqual(['GSI1']);
  });
});

describe('the real repository', () => {
  const io = { readFile: (f) => readFileSync(f, 'utf8'), exists: (f) => existsSync(f) };

  it('agrees that opting out of discovery reaches a GSI1 query', () => {
    // privacy-service's updateConsent calls withdrawFromOpenMatches on an
    // opt-out, which queries GSI1 for the candidate's open matches. The
    // consent Lambda was deployed without that grant, so the opt-out would
    // have failed after the flag was already flipped and the audit event
    // already written.
    const entry = join(apiRoot, 'handlers', 'privacy', 'consent.ts');
    expect(indexesUsedByHandler(entry, io)).toEqual(['GSI1']);
  });

  it('agrees the reminder job reaches GSI1', () => {
    const entry = join(apiRoot, 'handlers', 'jobs', 'verification-reminder-worker.ts');
    expect(indexesUsedByHandler(entry, io)).toEqual(['GSI1']);
  });

  it('agrees a plain single-item read reaches no index', () => {
    const entry = join(apiRoot, 'handlers', 'health.ts');
    expect(indexesUsedByHandler(entry, io)).toEqual([]);
  });

  /**
   * Given room to finish rather than left to flake.
   *
   * This walks every handler's real import graph across the whole api
   * package and reads both environments' main.tf. That is genuinely several
   * seconds of work, and under a full parallel suite it has come in at
   * 5.7s and 7.4s against vitest's 5s default. It passes in isolation every
   * time, so the failures were the clock, not the code — but a check that
   * fails a third of the time teaches people to re-run rather than read it,
   * which is how a real finding gets waved through.
   *
   * The timeout is raised rather than the work reduced: the point of this
   * test is that it audits the actual repository.
   *
   * Raised again on 2026-09-04 after it came in at 33.3s against the 30s
   * budget during a full validate:all sharing the machine with another
   * suite. Same conclusion as before, and re-confirmed the same way: three
   * consecutive isolated runs passed, and running the checker directly
   * reported both environments clean. The budget is now well clear of the
   * work so that a busy machine cannot fail a deploy that has nothing
   * wrong with it.
   */
  it('leaves the test environment with no missing or surplus grant', { timeout: 90_000 }, () => {
    expect(auditEnvironment('test', { root })).toEqual([]);
  });
});

describe('describeGsiFindings', () => {
  it('says so plainly when everything lines up', () => {
    expect(describeGsiFindings([], { environment: 'test' })).toBe(
      'test: every Lambda that can reach a GSI query is granted exactly that index.',
    );
  });

  it('names the bundle, what it reaches, and what is missing', () => {
    const text = describeGsiFindings(
      [
        {
          bundle: 'privacy-consent',
          needed: ['GSI1'],
          granted: [],
          missing: ['GSI1'],
          kind: 'missing-grant',
        },
      ],
      { environment: 'test' },
    );
    expect(text).toContain('privacy-consent reaches GSI1, granted nothing — missing GSI1');
    expect(text).toContain('AccessDeniedException');
  });
});
