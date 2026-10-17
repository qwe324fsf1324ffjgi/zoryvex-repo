// Compares the OpenAPI contract against the routes that actually exist.
//
// `npm run openapi:validate` answers a different question: it says the file
// is well formed, not that it describes the API. For most of this project's
// life it said "valid" about a file documenting one endpoint out of
// forty-one, while `docs/API.md` named that file the contract of record and
// stated that the only route so far was unauthenticated.
//
// Terraform is the source of truth here rather than the handler directory,
// because a handler with no `route_key` is not reachable and a `route_key`
// with no handler would not deploy. What is in the environment's route table
// is what the API is.
//
// Pure. The file reading lives in scripts/check-openapi-coverage.mjs.

/** Every `METHOD /path` a Terraform environment declares. */
export function routesFromTerraform(mainTfSource) {
  const routes = [];
  for (const match of mainTfSource.matchAll(/route_key\s*=\s*"([A-Z]+) ([^"]+)"/g)) {
    routes.push({ method: match[1].toLowerCase(), path: match[2] });
  }
  return routes;
}

/**
 * Every `METHOD /path` the spec documents.
 *
 * Parsed from the YAML text rather than a YAML library, which this repository
 * does not have and does not need one operation for: path keys sit at exactly
 * two spaces of indentation under `paths:`, and method keys at four. Anything
 * that does not match that shape is not a path or an operation.
 */
export function routesFromSpec(specSource) {
  const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
  const lines = specSource.split(/\r?\n/);

  const pathsIndex = lines.findIndex((line) => /^paths:\s*$/.test(line));
  if (pathsIndex === -1) throw new Error('The spec has no top-level `paths:` block.');

  const routes = [];
  let currentPath = null;

  for (let i = pathsIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\S/.test(line)) break; // back to a top-level key, so `paths` has ended

    const pathKey = /^ {2}(\/\S*):\s*$/.exec(line);
    if (pathKey) {
      currentPath = pathKey[1];
      continue;
    }

    const methodKey = /^ {4}([a-z]+):\s*$/.exec(line);
    if (methodKey && currentPath && HTTP_METHODS.includes(methodKey[1])) {
      routes.push({ method: methodKey[1], path: currentPath });
    }
  }

  return routes;
}

const key = (route) => `${route.method.toUpperCase()} ${route.path}`;

export function compareRoutes({ deployed, documented }) {
  const deployedKeys = new Set(deployed.map(key));
  const documentedKeys = new Set(documented.map(key));

  return {
    undocumented: [...deployedKeys].filter((k) => !documentedKeys.has(k)).sort(),
    // A documented route that does not exist is the more misleading of the
    // two: it invites somebody to build against something that will 404.
    imaginary: [...documentedKeys].filter((k) => !deployedKeys.has(k)).sort(),
    deployedCount: deployedKeys.size,
    documentedCount: documentedKeys.size,
  };
}

export function describeCoverage(result) {
  if (result.undocumented.length === 0 && result.imaginary.length === 0) {
    return `The contract documents all ${result.deployedCount} routes, and nothing that does not exist.`;
  }

  const lines = [];
  if (result.undocumented.length > 0) {
    lines.push('Routes that exist but are not in the contract:');
    for (const route of result.undocumented) lines.push(`  ${route}`);
  }
  if (result.imaginary.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push('Routes in the contract that do not exist:');
    for (const route of result.imaginary) lines.push(`  ${route}`);
  }
  lines.push(
    '',
    'packages/contracts/openapi.yaml is the contract of record. A route missing from it is ' +
      'undocumented; a route only in it is a promise the API does not keep.',
  );
  return lines.join('\n');
}
