// Validates .zoryvex/state.json against .zoryvex/state.schema.json.
//
// CLAUDE.md calls that file authoritative for phase, counters, checks and the
// next safe action, and every resume reads it before anything else. The schema
// sitting next to it had never actually been enforced: nothing under scripts/
// mentioned state.json, and `npm run validate:all` did not touch it. A hand
// check on 2026-09-05 found all 28 required properties present and every type
// matching, so this exists to keep the file valid rather than to fix it.
//
// It is hand-rolled rather than delegated to ajv. The only top-level ajv in
// the lockfile is 6.15.0, and it is there as a transitive dependency of
// eslint: it speaks draft-07, so it cannot read this draft 2020-12 schema at
// all, and reaching into another package's dependency means an eslint bump can
// remove it without warning. Adding ajv directly is a new moving part, which
// this repo does not take on without a cost memo.
//
// The trade is that only a subset of JSON Schema works here. SUPPORTED_KEYWORDS
// is exactly what the schema uses today, and an unrecognised keyword throws
// rather than being skipped — without that, adding `pattern` to the schema
// would look like tightening it while changing nothing, which is the same
// class of silent no-op this check was written to prevent.

/** Keywords that constrain a value. Everything reached must be one of these. */
const SUPPORTED_KEYWORDS = new Set([
  'type',
  'required',
  'properties',
  'additionalProperties',
  'items',
  'enum',
  'const',
  'minimum',
]);

// Keywords carrying no constraint. `format` is here on purpose: 2020-12 makes
// it an annotation by default, and ajv ignores it too without ajv-formats, so
// `utcTime`'s "date-time" documents the field rather than restricting it.
const ANNOTATION_KEYWORDS = new Set(['$schema', '$id', 'title', 'description', 'format']);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The JSON type name of a value, distinguishing integers the way the spec does. */
function typeName(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function matchesType(value, type) {
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'number') return typeof value === 'number';
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return isPlainObject(value);
  if (type === 'null') return value === null;
  return typeof value === type;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

const show = (value) => JSON.stringify(value) ?? String(value);

/** Every subschema of `schema`, itself included, paired with where it sits. */
function* subschemas(schema, path = '') {
  if (!isPlainObject(schema)) return;
  yield [schema, path];
  for (const [name, child] of Object.entries(schema.properties ?? {})) {
    yield* subschemas(child, `${path}.${name}`);
  }
  if (isPlainObject(schema.items)) yield* subschemas(schema.items, `${path}[]`);
  if (isPlainObject(schema.additionalProperties)) {
    yield* subschemas(schema.additionalProperties, `${path}.*`);
  }
}

/**
 * Throws when the schema uses a keyword this validator does not implement, so
 * the schema and the validator cannot drift apart quietly.
 */
export function assertSupportedSchema(schema) {
  for (const [node, path] of subschemas(schema)) {
    for (const keyword of Object.keys(node)) {
      if (SUPPORTED_KEYWORDS.has(keyword) || ANNOTATION_KEYWORDS.has(keyword)) continue;
      throw new Error(
        `Unsupported JSON Schema keyword "${keyword}" at ${path || '(root)'}. ` +
          'scripts/lib/state-schema.mjs implements only the subset the state schema ' +
          'uses; add support for it there rather than letting it be ignored.',
      );
    }
  }
}

function collectProblems(value, schema, path) {
  const problems = [];
  const where = path || '(root)';

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => matchesType(value, type))) {
      // Nothing below a wrong type is worth reporting — it would all be
      // consequences of the one problem already named.
      return [`${where}: expected ${types.join(' or ')}, got ${typeName(value)}`];
    }
  }

  if (schema.enum !== undefined && !schema.enum.some((allowed) => deepEqual(allowed, value))) {
    problems.push(`${where}: ${show(value)} is not one of ${schema.enum.map(show).join(', ')}`);
  }

  if ('const' in schema && !deepEqual(schema.const, value)) {
    problems.push(`${where}: expected ${show(schema.const)}, got ${show(value)}`);
  }

  if (schema.minimum !== undefined && typeof value === 'number' && value < schema.minimum) {
    problems.push(`${where}: ${value} is below the minimum of ${schema.minimum}`);
  }

  if (isPlainObject(value)) {
    for (const name of schema.required ?? []) {
      if (!Object.hasOwn(value, name)) {
        problems.push(`${where}: missing required property "${name}"`);
      }
    }

    const properties = schema.properties ?? {};
    for (const [name, child] of Object.entries(value)) {
      const childPath = `${path}.${name}`;
      if (Object.hasOwn(properties, name)) {
        problems.push(...collectProblems(child, properties[name], childPath));
      } else if (schema.additionalProperties === false) {
        problems.push(`${where}: unexpected property "${name}"`);
      } else if (isPlainObject(schema.additionalProperties)) {
        problems.push(...collectProblems(child, schema.additionalProperties, childPath));
      }
    }
  }

  if (Array.isArray(value) && schema.items !== undefined) {
    value.forEach((item, index) => {
      problems.push(...collectProblems(item, schema.items, `${path}[${index}]`));
    });
  }

  return problems;
}

/**
 * Validates a parsed document against a parsed schema.
 *
 * Returns one readable line per problem, each naming the property path it was
 * found at. An empty array means the document is valid.
 */
export function validateDocument(document, schema) {
  assertSupportedSchema(schema);
  return collectProblems(document, schema, '');
}
