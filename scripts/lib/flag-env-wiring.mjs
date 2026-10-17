// Finds Lambdas whose code gates on a feature flag but whose Terraform never
// tells them where the flags live.
//
// `getFeatureFlags()` fails closed: with no FEATURE_FLAGS_PARAM in the
// environment it returns DEFAULT_FEATURE_FLAGS, every flag false, without
// error. That is the right default for a flag read — a lockdown must never be
// defeated by a missing variable — but it makes a wiring mistake invisible.
// The route does not crash. It answers, politely, that the feature is paused.
//
// That is what had happened to contact unlock: `unlockContact` checks
// `flags.contactUnlocks` before doing anything else, its Terraform passed only
// TABLE_NAME, so every unlock returned "Contact unlocks are paused right now"
// no matter what the live parameter said. The paid, metered feature was off in
// a way no flag change could have turned on.
//
// Everything here is pure — file reading happens in the caller.

const FLAG_ENV_VAR = 'FEATURE_FLAGS_PARAM';

/**
 * The names of exported domain functions that read a flag.
 *
 * Function-level, not file-level, and that distinction is the whole accuracy
 * of this check. Three coarser versions were wrong. Walking the entire import
 * graph swept in every handler that touches a composition module, because
 * those import the flag repository on behalf of routes that gate on nothing:
 * twenty-six findings where ten were real. Expanding over domain-to-domain
 * imports was closer but `match-evidence-service` imports `isVerified` from
 * `matching-service`, a pure helper, and gates on nothing. Matching whole
 * files still over-reported four Kit routes, because `kit-service` exports
 * six functions and only `requestKitOrder` checks `flags.payments`.
 *
 * A check that reports healthy routes as broken gets switched off rather than
 * fixed. This one reports exactly the routes whose feature a missing variable
 * would silently disable.
 */
export function flagGatedExports(source) {
  const declaration = /^(export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/gm;
  const matches = [...source.matchAll(declaration)];

  const functions = matches.map((match, i) => ({
    name: match[2],
    exported: Boolean(match[1]),
    body: source.slice(match.index, i + 1 < matches.length ? matches[i + 1].index : source.length),
  }));

  const gated = new Set(
    functions.filter((fn) => /\bflags\.[A-Za-z]/.test(fn.body)).map((fn) => fn.name),
  );

  // Then within the module: a function that calls a gated one is gated too.
  // `recomputeMatchesForRole` never mentions a flag itself, it calls
  // `redactAiOutput` which does, and its route is just as dependent on
  // FEATURE_FLAGS_PARAM being set.
  //
  // Intra-module only. Following calls across modules is what produced the
  // false positives described above, because a module boundary here usually
  // does mean a different concern.
  let grew = true;
  while (grew) {
    grew = false;
    for (const fn of functions) {
      if (gated.has(fn.name)) continue;
      for (const name of gated) {
        if (new RegExp(`\\b${name}\\s*\\(`).test(fn.body)) {
          gated.add(fn.name);
          grew = true;
          break;
        }
      }
    }
  }

  return new Set(functions.filter((fn) => fn.exported && gated.has(fn.name)).map((fn) => fn.name));
}

/** Named imports per module specifier: `{ './x': ['a', 'b'] }`. */
export function namedImports(source) {
  const imports = {};
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
    const names = match[1]
      .split(',')
      .map((name) => name.replace(/^\s*type\s+/, '').trim())
      .filter(Boolean);
    imports[match[2]] = [...(imports[match[2]] ?? []), ...names];
  }
  return imports;
}

/**
 * Whether a handler imports a domain function that gates on a flag.
 *
 * Handlers here are thin: they import the one domain function they call, which
 * is what makes a direct named import the accurate signal.
 *
 * `gatedByModule` maps a domain module's base name (`kit-service`) to the set
 * of its exported function names that read a flag.
 */
export function handlerGatesOnFlags(handlerSource, gatedByModule) {
  for (const [specifier, names] of Object.entries(namedImports(handlerSource))) {
    if (!specifier.includes('/domain/')) continue;
    const moduleName = normalize(specifier).replace(/^.*\//, '');
    const gated = gatedByModule[moduleName];
    if (gated && names.some((name) => gated.has(name))) return true;
  }
  return false;
}

function normalize(path) {
  return path.split('\\').join('/');
}

/**
 * Pulls every `module "..." { ... }` that declares a Lambda handler out of an
 * environment's main.tf, with the handler path and the environment-variable
 * names it passes.
 *
 * Brace-counted rather than regex-matched, because an
 * `environment_variables = { ... }` map nests and a lazy match would stop at
 * the wrong brace and under-report — which for this check means reporting a
 * missing variable that is really there.
 */
export function parseLambdaModules(source) {
  const modules = [];
  const locals = parseLocalEnvMaps(source);
  const header = /module\s+"([A-Za-z0-9_]+)"\s*\{/g;

  for (const match of source.matchAll(header)) {
    const name = match[1];
    const bodyStart = match.index + match[0].length;
    const bodyEnd = matchingBrace(source, bodyStart);
    if (bodyEnd === -1) continue;

    const body = source.slice(bodyStart, bodyEnd);
    const handler = /\bhandler\s*=\s*"([^"]+)"/.exec(body);
    if (!handler) continue;

    modules.push({
      name,
      handler: handler[1],
      environmentVariables: environmentVariableNames(body, locals),
      // Two attribute names for the same grant: the api-route module calls it
      // secure_ssm_parameter_arns, the scheduled-job module ssm_parameter_arns.
      // Reading only the first reported the reminder job as ungranted when it
      // is granted, which is exactly the kind of false alarm that gets a check
      // switched off.
      ssmParameterGrants: [
        ...listItems(body, 'secure_ssm_parameter_arns'),
        ...listItems(body, 'ssm_parameter_arns'),
      ],
    });
  }

  return modules;
}

/**
 * `locals { auth_environment_variables = { TABLE_NAME = ..., ... } }`.
 *
 * Several routes build their environment as `merge(local.something, {...})`,
 * so a variable can be present without appearing anywhere in the module block.
 * Missing this would report a wiring gap that is not there, which is the one
 * failure mode that would get the check switched off.
 */
export function parseLocalEnvMaps(source) {
  const maps = {};
  const header = /\blocals\s*\{/g;

  for (const match of source.matchAll(header)) {
    const bodyStart = match.index + match[0].length;
    const bodyEnd = matchingBrace(source, bodyStart);
    if (bodyEnd === -1) continue;

    const body = source.slice(bodyStart, bodyEnd);
    const assignment = /^\s*([a-z][A-Za-z0-9_]*)\s*=\s*\{/gm;
    for (const local of body.matchAll(assignment)) {
      const mapStart = local.index + local[0].length;
      const mapEnd = matchingBrace(body, mapStart);
      if (mapEnd === -1) continue;
      maps[local[1]] = keyNames(body.slice(mapStart, mapEnd));
    }
  }

  return maps;
}

function matchingBrace(source, from) {
  let depth = 1;
  for (let i = from; i < source.length; i += 1) {
    const character = source[i];
    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function environmentVariableNames(moduleBody, locals = {}) {
  const start =
    /environment_variables\s*=\s*(?:merge\s*\(\s*(?:local\.([A-Za-z0-9_]+)\s*,\s*)?)?\{/.exec(
      moduleBody,
    );
  if (!start) return [];

  const names = start[1] && locals[start[1]] ? [...locals[start[1]]] : [];

  const bodyStart = start.index + start[0].length;
  const bodyEnd = matchingBrace(moduleBody, bodyStart);
  if (bodyEnd === -1) return names;

  return [...names, ...keyNames(moduleBody.slice(bodyStart, bodyEnd))];
}

function keyNames(mapBody) {
  const names = [];
  for (const match of mapBody.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=/gm)) names.push(match[1]);
  return names;
}

function listItems(moduleBody, attribute) {
  const start = new RegExp(`\\b${attribute}\\s*=\\s*\\[`).exec(moduleBody);
  if (!start) return [];
  const from = start.index + start[0].length;
  const end = moduleBody.indexOf(']', from);
  if (end === -1) return [];
  return moduleBody
    .slice(from, end)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * What each flag-gating route is missing, if anything.
 *
 * Two failures, not one, because they fail differently and the second is the
 * worse of the two. Without the variable, `getFeatureFlags()` returns the
 * closed defaults and the route reports its feature paused. Without the IAM
 * grant it throws: the repository catches ParameterNotFound and a JSON syntax
 * error and rethrows everything else, so an AccessDenied surfaces as a 500 on
 * a route that was working a moment before the variable was added.
 */
export function findUnwiredModules(modules, gatedHandlerNames) {
  const problems = [];

  for (const module of modules) {
    if (!gatedHandlerNames.has(module.handler)) continue;

    if (!module.environmentVariables.includes(FLAG_ENV_VAR)) {
      problems.push({
        ...module,
        problem:
          `does not set ${FLAG_ENV_VAR}. getFeatureFlags() returns every flag false, so this ` +
          'route reports its feature paused whatever the live parameter says',
      });
      continue;
    }

    if (!module.ssmParameterGrants.some((grant) => grant.includes('feature_flags'))) {
      problems.push({
        ...module,
        problem:
          `is not granted ssm:GetParameter on ${FLAG_ENV_VAR}, which it sets. The read throws ` +
          'AccessDenied and the route answers 500, which is worse than the quiet default it ' +
          'replaced',
      });
    }
  }

  return problems;
}

export { FLAG_ENV_VAR };
