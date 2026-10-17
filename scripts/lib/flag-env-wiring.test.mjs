import { describe, expect, it } from 'vitest';
import {
  findUnwiredModules,
  flagGatedExports,
  handlerGatesOnFlags,
  namedImports,
  parseLambdaModules,
  parseLocalEnvMaps,
} from './flag-env-wiring.mjs';

describe('flagGatedExports', () => {
  it('finds a function that reads a flag directly', () => {
    const source = [
      'export async function requestKitOrder(deps) {',
      '  const flags = await deps.getFeatureFlags();',
      '  if (!flags.payments) throw new ForbiddenError("unavailable");',
      '}',
    ].join('\n');
    expect([...flagGatedExports(source)]).toEqual(['requestKitOrder']);
  });

  it('leaves the other exports of the same module alone', () => {
    // kit-service exports six functions and only one gates on a flag. An
    // earlier version of this matched whole files and reported four healthy
    // Kit routes as broken.
    const source = [
      'export async function getKitPreview() {',
      '  return preview;',
      '}',
      'export async function requestKitOrder(deps) {',
      '  const flags = await deps.getFeatureFlags();',
      '  if (!flags.payments) throw new Error("no");',
      '}',
      'export async function getKitOrderStatus() {',
      '  return status;',
      '}',
    ].join('\n');
    expect([...flagGatedExports(source)]).toEqual(['requestKitOrder']);
  });

  it('follows a call to a gated function inside the same module', () => {
    // `recomputeMatchesForRole` names no flag. It calls `redactAiOutput`,
    // which does, and its route needs the variable just as much.
    const source = [
      'export function redactAiOutput(matches, flags) {',
      '  if (flags.aiMatching) return matches;',
      '  return matches.map(strip);',
      '}',
      'export async function recomputeMatchesForRole(roleId, deps) {',
      '  const matches = await deps.recompute(roleId);',
      '  return redactAiOutput(matches, await deps.getFeatureFlags());',
      '}',
    ].join('\n');
    expect([...flagGatedExports(source)].sort()).toEqual([
      'recomputeMatchesForRole',
      'redactAiOutput',
    ]);
  });

  it('propagates through an unexported helper', () => {
    const source = [
      'function assertEnabled(flags) {',
      '  if (!flags.contactUnlocks) throw new Error("paused");',
      '}',
      'export async function unlockContact(deps) {',
      '  assertEnabled(await deps.getFeatureFlags());',
      '}',
    ].join('\n');
    // The helper is not exported, so it is not reported — but what calls it is.
    expect([...flagGatedExports(source)]).toEqual(['unlockContact']);
  });

  it('reports nothing for a module that never mentions a flag', () => {
    const source =
      'export function isVerified(evidence) {\n  return evidence.state === "verified";\n}';
    expect([...flagGatedExports(source)]).toEqual([]);
  });
});

describe('handlerGatesOnFlags', () => {
  const gatedByModule = {
    'kit-service': new Set(['requestKitOrder']),
    'matching-service': new Set(['redactAiOutput', 'getMatchesForRole']),
  };

  it('matches on the specific function the handler imports', () => {
    const handler = "import { requestKitOrder } from '../../src/domain/kit-service';";
    expect(handlerGatesOnFlags(handler, gatedByModule)).toBe(true);
  });

  it('ignores a handler importing an ungated function from a gated module', () => {
    const handler = "import { getKitPreview } from '../../src/domain/kit-service';";
    expect(handlerGatesOnFlags(handler, gatedByModule)).toBe(false);
  });

  it('ignores imports that are not domain modules', () => {
    // Composition modules import the flag repository on behalf of routes that
    // gate on nothing. Counting those produced twenty-six findings where
    // ten were real.
    const handler = [
      "import { toHttpResponse } from '../../src/adapter/http';",
      "import { createAwsPrivacyDependencies } from '../../src/composition/aws-privacy-dependencies';",
      "import { exportCandidateData } from '../../src/domain/privacy-service';",
    ].join('\n');
    expect(handlerGatesOnFlags(handler, gatedByModule)).toBe(false);
  });
});

describe('namedImports', () => {
  it('strips type-only names', () => {
    const source = "import { unlockContact, type ContactUnlockResult } from './x';";
    expect(namedImports(source)).toEqual({ './x': ['unlockContact', 'ContactUnlockResult'] });
  });
});

describe('parseLambdaModules', () => {
  const source = [
    'module "matches_list_route" {',
    '  source = "../../modules/api-route"',
    '  handler = "handlers/matches-list.handler"',
    '  secure_ssm_parameter_arns = [aws_ssm_parameter.feature_flags.arn]',
    '  environment_variables = {',
    '    TABLE_NAME          = module.core_table.table_name',
    '    FEATURE_FLAGS_PARAM = aws_ssm_parameter.feature_flags.name',
    '  }',
    '}',
    'module "core_table" {',
    '  source = "../../modules/data"',
    '}',
  ].join('\n');

  it('reads only modules that declare a handler', () => {
    const modules = parseLambdaModules(source);
    expect(modules).toHaveLength(1);
    expect(modules[0].name).toBe('matches_list_route');
    expect(modules[0].handler).toBe('handlers/matches-list.handler');
  });

  it('reads the environment variable names and the SSM grants', () => {
    const [module] = parseLambdaModules(source);
    expect(module.environmentVariables).toContain('FEATURE_FLAGS_PARAM');
    expect(module.ssmParameterGrants).toEqual(['aws_ssm_parameter.feature_flags.arn']);
  });

  it('accepts the scheduled-job module’s different grant attribute', () => {
    // api-route calls it secure_ssm_parameter_arns, scheduled-job calls it
    // ssm_parameter_arns. Reading only the first reported the reminder job as
    // ungranted when it is granted.
    const job = [
      'module "verification_reminder_job" {',
      '  handler = "handlers/jobs-verification-reminder.handler"',
      '  ssm_parameter_arns = [aws_ssm_parameter.feature_flags.arn]',
      '  environment_variables = {',
      '    FEATURE_FLAGS_PARAM = aws_ssm_parameter.feature_flags.name',
      '  }',
      '}',
    ].join('\n');
    expect(parseLambdaModules(job)[0].ssmParameterGrants).toEqual([
      'aws_ssm_parameter.feature_flags.arn',
    ]);
  });

  it('resolves variables that arrive through merge(local.x, {...})', () => {
    const merged = [
      'locals {',
      '  auth_environment_variables = {',
      '    TABLE_NAME          = module.core_table.table_name',
      '    FEATURE_FLAGS_PARAM = aws_ssm_parameter.feature_flags.name',
      '  }',
      '}',
      'module "auth_route" {',
      '  handler = "handlers/auth-request-code.handler"',
      '  environment_variables = merge(local.auth_environment_variables, {',
      '    SIGN_IN_EMAIL_FROM = var.sign_in_email_from',
      '  })',
      '}',
    ].join('\n');
    const [module] = parseLambdaModules(merged);
    expect(module.environmentVariables).toContain('FEATURE_FLAGS_PARAM');
    expect(module.environmentVariables).toContain('SIGN_IN_EMAIL_FROM');
  });
});

describe('parseLocalEnvMaps', () => {
  it('reads the key names out of a locals map', () => {
    const source = 'locals {\n  env = {\n    A = 1\n    B = 2\n  }\n}';
    expect(parseLocalEnvMaps(source)).toEqual({ env: ['A', 'B'] });
  });
});

describe('findUnwiredModules', () => {
  const gated = new Set(['handlers/matches-unlock-contact.handler']);
  const base = {
    name: 'matches_unlock_contact_route',
    handler: 'handlers/matches-unlock-contact.handler',
  };

  it('reports a gated route with no FEATURE_FLAGS_PARAM', () => {
    // The real defect: contact unlock passed only TABLE_NAME, so every unlock
    // answered "paused" whatever the live parameter said.
    const problems = findUnwiredModules(
      [{ ...base, environmentVariables: ['TABLE_NAME'], ssmParameterGrants: [] }],
      gated,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].problem).toMatch(/does not set FEATURE_FLAGS_PARAM/);
  });

  it('reports a gated route that has the variable but not the grant', () => {
    // Worse than the first: the read throws AccessDenied and the route
    // answers 500 rather than falling back to the closed default.
    const problems = findUnwiredModules(
      [
        {
          ...base,
          environmentVariables: ['TABLE_NAME', 'FEATURE_FLAGS_PARAM'],
          ssmParameterGrants: ['local.paystack_secret_key_arn'],
        },
      ],
      gated,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].problem).toMatch(/not granted ssm:GetParameter/);
  });

  it('passes a route that has both', () => {
    expect(
      findUnwiredModules(
        [
          {
            ...base,
            environmentVariables: ['FEATURE_FLAGS_PARAM'],
            ssmParameterGrants: ['aws_ssm_parameter.feature_flags.arn'],
          },
        ],
        gated,
      ),
    ).toEqual([]);
  });

  it('says nothing about routes that do not gate on a flag', () => {
    expect(
      findUnwiredModules(
        [
          {
            name: 'roles_list_route',
            handler: 'handlers/roles-list.handler',
            environmentVariables: ['TABLE_NAME'],
            ssmParameterGrants: [],
          },
        ],
        gated,
      ),
    ).toEqual([]);
  });
});
