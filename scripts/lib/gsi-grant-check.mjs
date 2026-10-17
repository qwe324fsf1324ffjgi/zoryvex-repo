// Finds Lambda functions that reach a DynamoDB global-secondary-index query
// but whose IAM policy is scoped to the base table alone.
//
// This defect has already reached TEST twice, one function at a time, and
// each time it was found by a live acceptance attempt failing rather than by
// anything in CI. The shape is always the same:
// `infrastructure/modules/api-route` builds a function's DynamoDB policy from
// `concat([dynamodb_table_arn], dynamodb_index_arns)`, and a GSI Query
// authorizes against the *index* ARN, not the table's. Omit the index and the
// handler passes every unit test, deploys cleanly, and throws
// AccessDeniedException the first time a real request reaches that query.
//
// Nothing else catches it. The type checker cannot see IAM, Terraform cannot
// see the query, and a passing plan proves neither.
//
// The analysis is a call graph rather than a text search, because a text
// search cannot tell these two apart:
//
//   handlers/roles/list.ts  -> listRoles()      -> deps.listRolesByEmployer()
//   handlers/roles/get.ts   -> getRoleDetail()  -> deps.getRole()
//
// Both import the same repository module and the same composition root, so
// both mention `listRolesByEmployer` somewhere in their bundle. Only the
// first can ever call it. Granting the second GSI2 anyway would be a real
// loss — this project's IAM is a deliberate least-privilege attempt, and a
// check that quietly widens it to avoid thinking is worse than no check.

import { dirname, join, relative, resolve } from 'node:path';

const INDEX_PATTERN = /IndexName:\s*'(GSI\d)'/g;

/** Resolves a relative import specifier to a real .ts file, or null. */
function resolveImport(fromFile, specifier, { exists }) {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [`${base}.ts`, join(base, 'index.ts'), base]) {
    if (exists(candidate)) return candidate;
  }
  return null;
}

function importSpecifiers(source) {
  const specifiers = [];
  // Covers `import ... from '...'`, bare `import '...'`, `export ... from
  // '...'` and dynamic `import('...')` — every form this codebase uses.
  for (const match of source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]\s*\)?/g)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

/** Every .ts file reachable from `entry` by relative imports, entry included. */
export function moduleClosure(entry, { readFile, exists }) {
  const seen = new Set();
  const queue = [entry];
  const files = new Map();

  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);

    let source;
    try {
      source = readFile(file);
    } catch {
      continue;
    }
    files.set(file, source);

    for (const specifier of importSpecifiers(source)) {
      const resolved = resolveImport(file, specifier, { exists });
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }

  return files;
}

/**
 * Splits a module into its top-level declarations, exported or not, plus the
 * module-level code around them.
 *
 * Non-exported helpers have to be their own nodes. `privacy-service.ts`
 * reaches its GSI query through `withdrawFromOpenMatches`, a module-private
 * helper — attribute its body to whichever exported function happens to
 * precede it textually and the query gets credited to an unrelated function,
 * which is a false negative, the one direction this check must not fail in.
 */
export function declarationSlices(source) {
  const withoutInterfaces = stripTypeDeclarations(source);

  const starts = [];
  const declaration =
    /^(?:export\s+)?(?:(?:async\s+)?function\s+([A-Za-z0-9_]+)|const\s+([A-Za-z0-9_]+)\s*[:=])/gm;
  for (const match of withoutInterfaces.matchAll(declaration)) {
    starts.push({ name: match[1] ?? match[2], at: match.index });
  }

  const moduleLevelEnd = starts.length > 0 ? starts[0].at : withoutInterfaces.length;
  const slices = [{ name: '__module__', body: withoutInterfaces.slice(0, moduleLevelEnd) }];

  for (let i = 0; i < starts.length; i += 1) {
    const to = i + 1 < starts.length ? starts[i + 1].at : withoutInterfaces.length;
    slices.push({ name: starts[i].name, body: withoutInterfaces.slice(starts[i].at, to) });
  }

  return slices;
}

/**
 * Removes interface and object-type declarations before anything else looks
 * at the source. A dependencies interface writes
 * `listMatchesForCandidate(candidateId: string): Promise<Match[]>`, which is
 * indistinguishable from a call site to a pattern matcher.
 *
 * Anchored to the start of a line, with the closing brace also at the start
 * of a line. An unanchored version matched `type Candidate` inside an import
 * list and swallowed the whole handler body after it, which made a worker
 * that plainly calls a GSI query look like it called nothing.
 */
function stripTypeDeclarations(source) {
  return source.replace(
    /^(?:export\s+)?(?:interface|type)\s+[A-Za-z0-9_]+[^\n]*\{[\s\S]*?^\}/gm,
    '',
  );
}

function callsIn(text) {
  const called = new Set();
  for (const m of text.matchAll(/(?:deps\.)?\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) called.add(m[1]);
  return called;
}

/**
 * name -> the identifiers that name calls. `deps.name(` counts as calling
 * `name`: that is exactly how every domain service reaches an injected
 * repository function, and it is the edge that decides whether a GSI is
 * reachable.
 */
export function callGraphForModule(source) {
  const graph = new Map();
  const add = (name, calls) => {
    const existing = graph.get(name) ?? new Set();
    for (const call of calls) existing.add(call);
    graph.set(name, existing);
  };

  for (const { name, body } of declarationSlices(source)) {
    add(name, callsIn(body));
    // Composition roots wire some dependencies as an inline object method
    // rather than as a bare identifier, and those methods need nodes of their
    // own. See inlineMethodSlices for the false negative this closes.
    for (const method of inlineMethodSlices(body)) add(method.name, callsIn(method.body));
  }
  return graph;
}

/**
 * Object-literal methods nested inside a top-level declaration.
 *
 * A composition root wires most dependencies as a bare identifier, and those
 * already work: the name maps straight to the repository function that holds
 * the query. Some are wired as an inline method instead, because they do a
 * little work before delegating:
 *
 *   async hasMarketplaceEligibleRole(employerId) {
 *     const roles = await listRolesByEmployer(employerId);   // queries GSI2
 *
 * Those had no node. The walk reached the name from the domain service that
 * calls `deps.hasMarketplaceEligibleRole(...)`, found no outgoing edges, and
 * stopped one hop short of the query. `billing-create-subscription` was
 * granted no index on that basis and returned AccessDenied on GSI2 in TEST
 * for every subscription checkout, while this check reported it healthy.
 *
 * Deliberately additive: the calls stay attributed to the enclosing
 * declaration as well as to the method. Moving them would trade this false
 * negative for a different one wherever the enclosing function is reachable
 * and the method name is not, and a false negative is the one direction this
 * check must never fail in.
 */
export function inlineMethodSlices(body) {
  const slices = [];
  // Indented `name(...) {` or `async name(...) {`, which is the object-method
  // shorthand. Anchored to a line start with leading whitespace required, so
  // a top-level declaration cannot match and neither can a bare call.
  // `[^\S\r\n]` is horizontal whitespace: spaces and tabs but never a
  // newline, so the leading indent is required and cannot span lines.
  const pattern = /^[^\S\r\n]+(?:async\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\([^()]*\)\s*\{/gm;

  for (const match of body.matchAll(pattern)) {
    // Skip control keywords that share the shape of a method definition.
    if (['if', 'for', 'while', 'switch', 'catch', 'function', 'return'].includes(match[1])) {
      continue;
    }
    const open = body.indexOf('{', match.index + match[0].length - 1);
    if (open === -1) continue;

    let depth = 0;
    let end = -1;
    for (let i = open; i < body.length; i += 1) {
      if (body[i] === '{') depth += 1;
      else if (body[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    // Unbalanced braces mean the slice cannot be trusted, so the method is
    // skipped rather than given a body that runs to the end of the file.
    if (end === -1) continue;
    slices.push({ name: match[1], body: body.slice(open, end + 1) });
  }

  return slices;
}

/** Which GSIs each top-level declaration queries directly. */
export function gsiUsageByFunction(source) {
  const usage = new Map();
  for (const { name, body } of declarationSlices(source)) {
    if (name === '__module__') continue;
    const indexes = new Set();
    for (const match of body.matchAll(INDEX_PATTERN)) indexes.add(match[1]);
    if (indexes.size > 0) usage.set(name, [...indexes].sort());
  }
  return usage;
}

/**
 * The GSIs one handler can actually reach, by walking calls out from its
 * module-level code across every module in its bundle.
 */
export function indexesUsedByHandler(entry, io) {
  const files = moduleClosure(entry, io);

  // name -> GSIs, and name -> what that name calls, merged across the whole
  // bundle. Merging by name is right here: a repository function and the
  // injected `deps.` property that reaches it share the name deliberately,
  // and that shared name is the edge the walk needs.
  const gsiByName = new Map();
  const callsByName = new Map();

  for (const [, source] of files) {
    for (const [name, indexes] of gsiUsageByFunction(source)) {
      gsiByName.set(name, [...new Set([...(gsiByName.get(name) ?? []), ...indexes])].sort());
    }
    for (const [name, calls] of callGraphForModule(source)) {
      const merged = callsByName.get(name) ?? new Set();
      for (const call of calls) merged.add(call);
      callsByName.set(name, merged);
    }
  }

  // The walk starts at this handler's own module-level code and at its
  // exported `handler`, which is the Lambda's real entry point.
  const entryGraph = callGraphForModule(files.get(entry) ?? '');
  const seen = new Set();
  const queue = [...(entryGraph.get('__module__') ?? []), ...(entryGraph.get('handler') ?? [])];
  const needed = new Set();

  while (queue.length > 0) {
    const name = queue.pop();
    if (seen.has(name)) continue;
    seen.add(name);

    for (const index of gsiByName.get(name) ?? []) needed.add(index);
    for (const next of callsByName.get(name) ?? []) {
      if (!seen.has(next)) queue.push(next);
    }
  }

  return [...needed].sort();
}

/**
 * Reads one environment's main.tf and returns, per Lambda *bundle* name, the
 * GSIs its module block grants.
 *
 * Keyed on the block's `handler = "handlers/<bundle>.handler"` rather than on
 * `function_name`, because that string is the same identifier the build uses
 * and cannot drift from it — the scheduled-job module, for instance, names
 * its function `zoryvex-test-verification-reminder` while its bundle is
 * `jobs-verification-reminder`.
 */
export function grantedIndexesByBundle(mainTfSource) {
  const grants = new Map();

  for (const block of mainTfSource.split(/\nmodule "/).slice(1)) {
    const handlerMatch = /handler\s*=\s*"handlers\/([A-Za-z0-9-]+)\.handler"/.exec(block);
    if (!handlerMatch) continue;

    const indexes = new Set();
    const grantMatch = /dynamodb_index_arns\s*=\s*\[([^\]]*)\]/.exec(block);
    if (grantMatch) {
      for (const m of grantMatch[1].matchAll(/core_table_gsi(\d)_arn/g)) indexes.add(`GSI${m[1]}`);
    }
    grants.set(handlerMatch[1], [...indexes].sort());
  }

  return grants;
}

export function auditGsiGrants({ handlers, mainTfSource, io }) {
  const grants = grantedIndexesByBundle(mainTfSource);
  const findings = [];

  for (const { name, entry } of handlers) {
    const needed = indexesUsedByHandler(entry, io);
    const granted = grants.get(name);

    if (granted === undefined) {
      // Not every handler is deployed in every environment — production
      // lags test by design while it stays unapplied. Only report it when
      // the missing block would also have needed a grant, which is the case
      // that could actually break something once it is added.
      if (needed.length > 0) {
        findings.push({ bundle: name, needed, granted: null, kind: 'no-module-block' });
      }
      continue;
    }

    const missing = needed.filter((index) => !granted.includes(index));
    if (missing.length > 0) {
      findings.push({ bundle: name, needed, granted, missing, kind: 'missing-grant' });
    }

    const surplus = granted.filter((index) => !needed.includes(index));
    if (surplus.length > 0) {
      findings.push({ bundle: name, needed, granted, surplus, kind: 'surplus-grant' });
    }
  }

  return findings;
}

export function describeGsiFindings(findings, { environment, root = '' }) {
  if (findings.length === 0) {
    return `${environment}: every Lambda that can reach a GSI query is granted exactly that index.`;
  }

  const mainTf = relative(root, join('infrastructure', 'envs', environment, 'main.tf'));
  const lines = [`${environment}: GSI grants do not match what the handlers can reach.`];

  for (const f of findings) {
    if (f.kind === 'no-module-block') {
      lines.push(`  ${f.bundle} reaches ${f.needed.join(', ')} but has no module block here.`);
    } else if (f.kind === 'missing-grant') {
      lines.push(
        `  ${f.bundle} reaches ${f.needed.join(', ')}, granted ${
          f.granted.length > 0 ? f.granted.join(', ') : 'nothing'
        } — missing ${f.missing.join(', ')}. This throws AccessDeniedException the first time a ` +
          'real request reaches that query.',
      );
    } else {
      lines.push(
        `  ${f.bundle} is granted ${f.surplus.join(', ')} it cannot reach. Not a failure, but it ` +
          'widens the policy past what the code needs.',
      );
    }
  }

  lines.push('', `Fix in ${mainTf}, on that module block's dynamodb_index_arns.`);
  return lines.join('\n');
}
