import { describe, expect, it } from 'vitest';
import {
  DeployInputError,
  EXPECTED_AWS_ACCOUNT_ID,
  assertExpectedAwsAccount,
  backendConfigArgs,
  confirmationAuthorizesProductionRelease,
  confirmationMatchesEnvironment,
  describeBlankingRegressions,
  detectBlankingRegressions,
  hasDangerousDestroy,
  planArtifactPath,
  spawnPlanFor,
  stateBucketName,
  summarizePlan,
  testSiteBucketName,
  timestampForPlanFile,
  validateEnvironment,
} from './deploy-lib.mjs';

describe('validateEnvironment', () => {
  it('accepts test and production', () => {
    expect(validateEnvironment('test')).toBe('test');
    expect(validateEnvironment('production')).toBe('production');
  });

  it('rejects anything else, including a close-but-wrong value', () => {
    for (const bad of ['prod', 'Test', 'production ', '', undefined, null]) {
      expect(() => validateEnvironment(bad)).toThrow(DeployInputError);
    }
  });
});

describe('confirmationMatchesEnvironment', () => {
  it('requires an exact, case-sensitive match', () => {
    expect(confirmationMatchesEnvironment('production', 'production')).toBe(true);
    expect(confirmationMatchesEnvironment('Production', 'production')).toBe(false);
    expect(confirmationMatchesEnvironment('production ', 'production')).toBe(false);
    expect(confirmationMatchesEnvironment('test', 'production')).toBe(false);
    expect(confirmationMatchesEnvironment(undefined, 'production')).toBe(false);
  });
});

describe('confirmationAuthorizesProductionRelease', () => {
  it('requires production env, matching env confirmation, and the literal word PRODUCTION', () => {
    expect(confirmationAuthorizesProductionRelease('production', 'production', 'PRODUCTION')).toBe(
      true,
    );
  });

  it('refuses for test even if someone types PRODUCTION', () => {
    expect(confirmationAuthorizesProductionRelease('test', 'test', 'PRODUCTION')).toBe(false);
  });

  it('refuses production without the second literal confirmation', () => {
    expect(confirmationAuthorizesProductionRelease('production', 'production', 'production')).toBe(
      false,
    );
    expect(confirmationAuthorizesProductionRelease('production', 'production', undefined)).toBe(
      false,
    );
  });

  it('refuses production if only the second confirmation is right but the first is not', () => {
    expect(confirmationAuthorizesProductionRelease('production', 'prod', 'PRODUCTION')).toBe(false);
  });
});

describe('timestampForPlanFile / planArtifactPath', () => {
  it('formats a fixed date deterministically', () => {
    const date = new Date(Date.UTC(2026, 7, 18, 9, 5, 3)); // 2026-08-18T09:05:03Z
    expect(timestampForPlanFile(date)).toBe('20260818-090503');
  });

  it('builds a per-environment path under .terraform-plans/', () => {
    const date = new Date(Date.UTC(2026, 7, 18, 9, 5, 3));
    expect(planArtifactPath('test', timestampForPlanFile(date))).toBe(
      '.terraform-plans/test/20260818-090503.tfplan',
    );
  });

  it('rejects an invalid environment', () => {
    expect(() => planArtifactPath('staging')).toThrow(DeployInputError);
  });
});

describe('summarizePlan', () => {
  it('counts create/update/delete and lists destroyed resources', () => {
    const planJson = {
      resource_changes: [
        {
          address: 'aws_lambda_function.a',
          type: 'aws_lambda_function',
          change: { actions: ['create'] },
        },
        {
          address: 'aws_lambda_function.b',
          type: 'aws_lambda_function',
          change: { actions: ['update'] },
        },
        {
          address: 'aws_dynamodb_table.core',
          type: 'aws_dynamodb_table',
          change: { actions: ['delete'] },
        },
        {
          address: 'aws_lambda_function.c',
          type: 'aws_lambda_function',
          change: { actions: ['no-op'] },
        },
      ],
    };

    const summary = summarizePlan(planJson);
    expect(summary.add).toBe(1);
    expect(summary.change).toBe(1);
    expect(summary.destroy).toBe(1);
    expect(summary.destroyed).toEqual([
      { address: 'aws_dynamodb_table.core', type: 'aws_dynamodb_table' },
    ]);
  });

  it('treats delete-then-create (replace) as a destroy, not a plain create', () => {
    const planJson = {
      resource_changes: [
        { address: 'x', type: 'aws_lambda_function', change: { actions: ['delete', 'create'] } },
      ],
    };
    const summary = summarizePlan(planJson);
    expect(summary.add).toBe(0);
    expect(summary.destroy).toBe(1);
  });

  it('handles an empty plan', () => {
    expect(summarizePlan({})).toEqual({ add: 0, change: 0, destroy: 0, destroyed: [] });
  });
});

describe('hasDangerousDestroy', () => {
  it('flags a stateful resource type', () => {
    const summary = { destroyed: [{ address: 'aws_s3_bucket.evidence', type: 'aws_s3_bucket' }] };
    expect(hasDangerousDestroy(summary)).toBe(true);
  });

  it('does not flag a stateless resource type', () => {
    const summary = {
      destroyed: [{ address: 'aws_lambda_function.old', type: 'aws_lambda_function' }],
    };
    expect(hasDangerousDestroy(summary)).toBe(false);
  });

  it('handles nothing destroyed', () => {
    expect(hasDangerousDestroy({ destroyed: [] })).toBe(false);
  });
});

describe('detectBlankingRegressions', () => {
  const lambdaChange = (before, after, afterUnknown = {}) => ({
    resource_changes: [
      {
        address: 'module.webauthn_register_options_route.aws_lambda_function.this',
        type: 'aws_lambda_function',
        change: {
          actions: ['update'],
          before: { environment: [{ variables: before }] },
          after: { environment: [{ variables: after }] },
          after_unknown: { environment: [{ variables: afterUnknown }] },
        },
      },
    ],
  });

  it('catches the real case: a live Lambda env var emptied by a missing deploy input', () => {
    // The webauthn_rp_id gap. Set in the gitignored terraform.tfvars, never
    // supplied to CI, empty default — so the pipeline's first apply would
    // have written "" over a working value.
    const findings = detectBlankingRegressions(
      lambdaChange(
        { WEBAUTHN_RP_ID: 'test.zoryvex.space', APP_ORIGIN: 'https://test.zoryvex.space' },
        { WEBAUTHN_RP_ID: '', APP_ORIGIN: 'https://test.zoryvex.space' },
      ),
    );

    expect(findings).toEqual([
      {
        address: 'module.webauthn_register_options_route.aws_lambda_function.this',
        attribute: 'environment.variables.WEBAUTHN_RP_ID',
        before: 'test.zoryvex.space',
        after: '',
      },
    ]);
  });

  it('treats a dropped key the same as an emptied one', () => {
    const findings = detectBlankingRegressions(
      lambdaChange({ APP_ORIGIN: 'https://test.zoryvex.space' }, {}),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].after).toBeNull();
  });

  it('allows the reverse — filling in a value that was empty', () => {
    expect(
      detectBlankingRegressions(
        lambdaChange({ WEBAUTHN_RP_ID: '' }, { WEBAUTHN_RP_ID: 'x.example' }),
      ),
    ).toEqual([]);
  });

  it('allows an ordinary value change', () => {
    expect(
      detectBlankingRegressions(
        lambdaChange({ APP_ORIGIN: 'https://a' }, { APP_ORIGIN: 'https://b' }),
      ),
    ).toEqual([]);
  });

  it('skips values Terraform cannot resolve until apply time', () => {
    // after is null for an unknown value. Reading that as "empty" would fire
    // on ordinary deploys and train an operator to pass --allow-blanking by
    // reflex, which costs more than the check saves.
    expect(
      detectBlankingRegressions(
        lambdaChange(
          { TABLE_NAME: 'zoryvex-test-core' },
          { TABLE_NAME: null },
          { TABLE_NAME: true },
        ),
      ),
    ).toEqual([]);
  });

  it('catches CORS allow-origins collapsing to an empty list', () => {
    // app_origin unset makes local.app_origins [] — the API would still
    // deploy and /health would still pass, while every browser call failed
    // preflight.
    const findings = detectBlankingRegressions({
      resource_changes: [
        {
          address: 'module.api_gateway.aws_apigatewayv2_api.this',
          type: 'aws_apigatewayv2_api',
          change: {
            actions: ['update'],
            before: { cors_configuration: [{ allow_origins: ['https://test.zoryvex.space'] }] },
            after: { cors_configuration: [{ allow_origins: [] }] },
          },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].attribute).toBe('cors_configuration.0.allow_origins');
  });

  it('catches CloudFront aliases being dropped', () => {
    const findings = detectBlankingRegressions({
      resource_changes: [
        {
          address: 'module.static_site.aws_cloudfront_distribution.site',
          type: 'aws_cloudfront_distribution',
          change: {
            actions: ['update'],
            before: { aliases: ['test.zoryvex.space'] },
            after: { aliases: [] },
          },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].attribute).toBe('aliases');
  });

  it('ignores creates and deletes — only an update can silently blank something', () => {
    expect(
      detectBlankingRegressions({
        resource_changes: [
          {
            address: 'module.x.aws_lambda_function.this',
            type: 'aws_lambda_function',
            change: {
              actions: ['delete'],
              before: { environment: [{ variables: { APP_ORIGIN: 'https://a' } }] },
              after: null,
            },
          },
        ],
      }),
    ).toEqual([]);
  });

  it('handles an empty plan', () => {
    expect(detectBlankingRegressions({})).toEqual([]);
  });
});

describe('describeBlankingRegressions', () => {
  it('names the resource, the attribute, and both values', () => {
    const text = describeBlankingRegressions([
      {
        address: 'module.a.aws_lambda_function.this',
        attribute: 'environment.variables.WEBAUTHN_RP_ID',
        before: 'test.zoryvex.space',
        after: '',
      },
    ]);
    expect(text).toBe(
      '  - module.a.aws_lambda_function.this: environment.variables.WEBAUTHN_RP_ID ' +
        '"test.zoryvex.space" -> ""',
    );
  });

  it('renders nothing for no findings', () => {
    expect(describeBlankingRegressions([])).toBe('');
  });
});

describe('stateBucketName', () => {
  it('derives the one shared state bucket from an account id', () => {
    expect(stateBucketName('071770169654')).toBe('zoryvex-terraform-state-071770169654');
  });

  it('is a pure string derivation — any account id produces the matching bucket', () => {
    expect(stateBucketName('999999999999')).toBe('zoryvex-terraform-state-999999999999');
  });
});

describe('testSiteBucketName', () => {
  it('derives the test static-site bucket from an account id', () => {
    expect(testSiteBucketName('071770169654')).toBe('zoryvex-test-site-071770169654');
  });

  it('is a pure string derivation — any account id produces the matching bucket', () => {
    expect(testSiteBucketName('999999999999')).toBe('zoryvex-test-site-999999999999');
  });
});

describe('backendConfigArgs', () => {
  it('builds the exact TEST backend config: key, region, locking, encryption', () => {
    const args = backendConfigArgs('test', '071770169654');
    expect(args).toContain('-backend-config=bucket=zoryvex-terraform-state-071770169654');
    expect(args).toContain('-backend-config=key=test/terraform.tfstate');
    expect(args).toContain('-backend-config=region=eu-west-1');
    expect(args).toContain('-backend-config=use_lockfile=true');
    expect(args).toContain('-backend-config=encrypt=true');
  });

  it('defaults to eu-west-1 but accepts an explicit region', () => {
    const args = backendConfigArgs('test', '071770169654', { region: 'us-east-1' });
    expect(args).toContain('-backend-config=region=us-east-1');
  });

  it('derives the production key only for the production environment', () => {
    const args = backendConfigArgs('production', '071770169654');
    expect(args).toContain('-backend-config=key=production/terraform.tfstate');
  });

  it('rejects an invalid environment using the existing validation semantics, before constructing anything', () => {
    for (const bad of ['foundation', 'bootstrap', 'test-secrets', 'staging', '']) {
      expect(() => backendConfigArgs(bad, '071770169654')).toThrow(DeployInputError);
    }
  });

  it('can never produce a foundation/bootstrap/test-secrets key for a valid environment', () => {
    for (const env of ['test', 'production']) {
      const args = backendConfigArgs(env, '071770169654');
      const keyArg = args.find((a) => a.startsWith('-backend-config=key='));
      expect(keyArg).toMatch(/^-backend-config=key=(test|production)\/terraform\.tfstate$/);
    }
  });

  it('offers no parameter through which an arbitrary bucket or key can be supplied', () => {
    // The function's only inputs are env (validated) and accountId (used
    // solely to build the one fixed bucket-name pattern) — there is no
    // third "bucket" or "key" argument to override either.
    expect(backendConfigArgs.length).toBe(2); // env, accountId — options object with a default isn't counted
  });
});

describe('assertExpectedAwsAccount', () => {
  it('passes through the expected account id unchanged', () => {
    expect(assertExpectedAwsAccount(EXPECTED_AWS_ACCOUNT_ID)).toBe(EXPECTED_AWS_ACCOUNT_ID);
  });

  it('fails closed for any other account id, including a plausible-looking one', () => {
    expect(() => assertExpectedAwsAccount('123456789012')).toThrow(DeployInputError);
  });

  it('fails closed for empty/undefined identity resolution', () => {
    expect(() => assertExpectedAwsAccount('')).toThrow(DeployInputError);
    expect(() => assertExpectedAwsAccount(undefined)).toThrow(DeployInputError);
  });
});

describe('spawnPlanFor', () => {
  /**
   * The 2026-09-01 billing apply changed every resource in AWS and then died
   * between the apply and the site sync, twice: first on "spawnSync npm
   * ENOENT", then on "spawnSync npm.cmd EINVAL" after a fix that was only
   * half of one. Both were verified in isolation before this shape was
   * settled on, rather than by running another deploy to find out.
   */
  it('gives npm and npx a shim and a shell on Windows', () => {
    expect(spawnPlanFor('npm', ['run', 'build'], 'win32')).toEqual({
      command: 'npm.cmd',
      shell: true,
    });
    expect(spawnPlanFor('npx', ['prettier'], 'win32')).toEqual({
      command: 'npx.cmd',
      shell: true,
    });
  });

  it('leaves real executables alone on Windows, which is why the failure came so late', () => {
    for (const command of ['terraform', 'aws', 'git']) {
      expect(spawnPlanFor(command, ['--version'], 'win32')).toEqual({ command, shell: false });
    }
  });

  it('changes nothing on the platforms CI runs on', () => {
    for (const platform of ['linux', 'darwin']) {
      for (const command of ['npm', 'npx', 'terraform', 'aws']) {
        expect(spawnPlanFor(command, ['x'], platform)).toEqual({ command, shell: false });
      }
    }
  });

  /**
   * A shell concatenates arguments instead of escaping them, so this refuses
   * rather than silently passing something through that no longer means what
   * it said. Only reachable on Windows, and only for the two shims.
   */
  it('refuses arguments a shell would not preserve', () => {
    expect(() => spawnPlanFor('npm', ['run', 'build', 'C:\\Program Files\\web'], 'win32')).toThrow(
      DeployInputError,
    );
    expect(() => spawnPlanFor('npm', ['run', 'a && rm -rf b'], 'win32')).toThrow(DeployInputError);
    expect(() => spawnPlanFor('npm', ['run', '$(whoami)'], 'win32')).toThrow(DeployInputError);
  });

  it('allows the arguments this project actually passes', () => {
    expect(() => spawnPlanFor('npm', ['run', 'build', '-w', 'apps/web'], 'win32')).not.toThrow();
  });

  it('does not apply the argument rule off Windows, where no shell is used', () => {
    expect(() => spawnPlanFor('npm', ['run', 'a b c'], 'linux')).not.toThrow();
  });
});
