import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The contract must describe the body each handler actually accepts.
 *
 * `openapi-schema-parity.test.ts` compares the named component schemas
 * against their zod definitions, and it has caught real drift. It cannot
 * see a request body, because request bodies are written inline in the
 * operation rather than as components, so nothing compared them to
 * anything.
 *
 * Three of them had drifted. `PATCH /candidates/me` documented five
 * properties and accepted ten, omitting the contact channels, the
 * location and the whole of intent. `POST /roles` and `PATCH
 * /roles/{roleId}` omitted the location requirement and intent the same
 * way. Every one of those blocks also carries `additionalProperties:
 * false`, so the published contract did not merely fail to mention the
 * fields, it said they would be rejected — while the API stored them. A
 * client written from the contract could not state a pay range at all,
 * and would have been right to think the feature did not exist.
 *
 * The handler is the source of truth here and the spec follows it, which
 * is the same direction the component parity test runs in.
 */

const HANDLER_DIR = join(import.meta.dirname, '..', 'handlers');
const SPEC = join(import.meta.dirname, '..', '..', '..', 'packages', 'contracts', 'openapi.yaml');

/**
 * Handler file to the operationId documenting it.
 *
 * Written out rather than derived. The route table maps a path to a
 * Lambda name and the spec maps a path to an operationId, so a derivation
 * would go through two indirections and break quietly; and a check below
 * fails if a handler that reads a JSON body is missing from this map, so
 * the list cannot silently fall behind.
 */
const BODY_HANDLERS: Record<string, string> = {
  'auth/request-code.ts': 'requestSignInCode',
  'auth/consume-code.ts': 'consumeSignInCode',
  'auth/webauthn-register-verify.ts': 'finishWebAuthnRegistration',
  'auth/webauthn-step-up-verify.ts': 'finishWebAuthnStepUp',
  'candidates/profile-update.ts': 'updateOwnCandidateProfile',
  'candidates/evidence-create.ts': 'createOwnEvidence',
  'candidates/evidence-update.ts': 'updateOwnEvidence',
  'candidates/evidence-verify.ts': 'verifyEvidence',
  'candidates/set-interest.ts': 'setCandidateInterest',
  'evidence/request-upload.ts': 'requestEvidenceUpload',
  'matches/set-employer-interest.ts': 'setEmployerInterest',
  'peer/confirm.ts': 'confirmPeerAttestation',
  'peer/preview.ts': 'previewPeerRequest',
  'peer/request.ts': 'requestPeerAttestation',
  'privacy/consent.ts': 'updateConsent',
  'roles/create.ts': 'createOwnRole',
  'roles/update.ts': 'updateOwnRole',
};

/** Every handler file that parses a JSON body, relative to handlers/. */
function handlersReadingABody(dir = HANDLER_DIR, prefix = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...handlersReadingABody(join(dir, entry.name), rel));
    } else if (entry.name.endsWith('.ts')) {
      if (readFileSync(join(dir, entry.name), 'utf8').includes('parseJsonBody')) found.push(rel);
    }
  }
  return found;
}

/**
 * Top-level keys of the `z.object({...})` a handler validates its body
 * with. Brace-counted from the call, so a nested object contributes
 * nothing of its own.
 */
function handlerBodyFields(file: string): string[] {
  const source = readFileSync(join(HANDLER_DIR, file), 'utf8');
  const start = /(?:const|export const)\s+\w*Schema\s*=\s*z\s*\.object\(\{/.exec(source);
  if (!start) return [];
  const open = start.index + start[0].length - 1;

  let depth = 0;
  let end = open;
  for (; end < source.length; end += 1) {
    const ch = source[end];
    if (ch === '{' || ch === '[' || ch === '(') depth += 1;
    else if (ch === '}' || ch === ']' || ch === ')') {
      depth -= 1;
      if (depth === 0) break;
    }
  }

  const fields: string[] = [];
  let nesting = 0;
  for (const line of source.slice(open + 1, end).split('\n')) {
    const trimmed = line.trim();
    if (nesting === 0) {
      const key = /^([A-Za-z_]\w*)\s*:/.exec(trimmed);
      if (key) fields.push(key[1]!);
    }
    for (const ch of line) {
      if (ch === '{' || ch === '[' || ch === '(') nesting += 1;
      else if (ch === '}' || ch === ']' || ch === ')') nesting -= 1;
    }
  }
  return fields;
}

/**
 * Documented request-body property names for one operationId.
 *
 * Read out of the YAML text, the same way `openapi-coverage.mjs` reads
 * routes: this repository has no YAML parser and does not need one for a
 * block whose indentation is fixed by the spec's own layout.
 */
function documentedBodyFields(operationId: string): string[] | null {
  const lines = readFileSync(SPEC, 'utf8').split(/\r?\n/);
  const at = lines.findIndex((line) => line.trim() === `operationId: ${operationId}`);
  if (at === -1) return null;

  // Forward to this operation's requestBody, stopping at the next operation.
  let bodyAt = -1;
  for (let i = at + 1; i < lines.length; i += 1) {
    if (/^\s{4}[a-z]+:\s*$/.test(lines[i]!) || /operationId:/.test(lines[i]!)) break;
    if (lines[i]!.trim() === 'requestBody:') {
      bodyAt = i;
      break;
    }
  }
  if (bodyAt === -1) return [];

  const propsAt = lines.findIndex((line, i) => i > bodyAt && line.trim() === 'properties:');
  if (propsAt === -1) return [];
  const indent = (lines[propsAt]!.match(/^\s*/) ?? [''])[0].length + 2;

  const fields: string[] = [];
  for (let i = propsAt + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.trim() === '') continue;
    const at2 = (line.match(/^\s*/) ?? [''])[0].length;
    if (at2 < indent) break;
    if (at2 !== indent) continue;
    const key = /^\s*([A-Za-z_]\w*):/.exec(line);
    if (key) fields.push(key[1]!);
  }
  return fields;
}

describe('every documented request body matches the handler that receives it', () => {
  it('knows about every handler that reads a body', () => {
    const missing = handlersReadingABody().filter((file) => !(file in BODY_HANDLERS));
    expect(
      missing,
      'a handler parses a JSON body and is not in BODY_HANDLERS — add it with its operationId',
    ).toEqual([]);
  });

  it('finds each operationId in the spec', () => {
    const absent = Object.values(BODY_HANDLERS).filter(
      (operationId) => documentedBodyFields(operationId) === null,
    );
    expect(absent).toEqual([]);
  });

  it('reads real field lists out of the handlers', () => {
    // A parser that silently returns nothing would make the comparison
    // below pass for every endpoint at once.
    expect(handlerBodyFields('roles/create.ts')).toContain('launchTrack');
    expect(handlerBodyFields('candidates/profile-update.ts')).toContain('version');
  });

  it('documents every field the handler accepts', () => {
    const gaps: string[] = [];

    for (const [file, operationId] of Object.entries(BODY_HANDLERS)) {
      const accepted = handlerBodyFields(file);
      if (accepted.length === 0) continue;
      const documented = new Set(documentedBodyFields(operationId) ?? []);
      const undocumented = accepted.filter((field) => !documented.has(field));
      if (undocumented.length > 0) {
        gaps.push(`${operationId} (${file}) accepts undocumented ${undocumented.join(', ')}`);
      }
    }

    expect(gaps).toEqual([]);
  });

  it('documents nothing the handler would reject', () => {
    const invented: string[] = [];

    for (const [file, operationId] of Object.entries(BODY_HANDLERS)) {
      const accepted = new Set(handlerBodyFields(file));
      if (accepted.size === 0) continue;
      const documented = documentedBodyFields(operationId) ?? [];
      const extra = documented.filter((field) => !accepted.has(field));
      if (extra.length > 0) {
        invented.push(`${operationId} (${file}) documents ${extra.join(', ')}, which it rejects`);
      }
    }

    expect(invented).toEqual([]);
  });
});
