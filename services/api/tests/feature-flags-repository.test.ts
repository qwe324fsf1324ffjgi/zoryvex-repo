import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { GetParameterCommand, ParameterNotFound, SSMClient } from '@aws-sdk/client-ssm';
import { DEFAULT_FEATURE_FLAGS } from '@zoryvex/config';
import { getFeatureFlags } from '../src/repositories/feature-flags-repository';

const ssmMock = mockClient(SSMClient);

describe('getFeatureFlags', () => {
  beforeEach(() => {
    ssmMock.reset();
    process.env.FEATURE_FLAGS_PARAM = '/zoryvex/test/feature-flags';
  });
  afterEach(() => {
    delete process.env.FEATURE_FLAGS_PARAM;
  });

  it('returns the parsed flags on a well-formed parameter value', async () => {
    ssmMock.on(GetParameterCommand).resolves({
      Parameter: { Value: JSON.stringify({ payments: false, aiMatching: true }) },
    });
    const flags = await getFeatureFlags();
    // Missing keys fall back to their schema defaults, so this asserts
    // against the real defaults rather than a hand-maintained copy that
    // breaks every time a flag is added.
    expect(flags).toEqual({ ...DEFAULT_FEATURE_FLAGS, aiMatching: true });
    const call = ssmMock.commandCalls(GetParameterCommand)[0];
    expect(call!.args[0].input.Name).toBe('/zoryvex/test/feature-flags');
    expect(call!.args[0].input.WithDecryption).toBeFalsy();
  });

  it('fails closed to every-flag-false when the parameter does not exist', async () => {
    ssmMock
      .on(GetParameterCommand)
      .rejects(new ParameterNotFound({ message: 'not found', $metadata: {} }));
    expect(await getFeatureFlags()).toEqual(DEFAULT_FEATURE_FLAGS);
  });

  it('fails closed when the parameter value is not valid JSON', async () => {
    ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: 'not json' } });
    expect(await getFeatureFlags()).toEqual(DEFAULT_FEATURE_FLAGS);
  });

  it('fails closed when the parameter value fails schema validation', async () => {
    ssmMock
      .on(GetParameterCommand)
      .resolves({ Parameter: { Value: JSON.stringify({ aiMatching: 'yes' }) } });
    expect(await getFeatureFlags()).toEqual(DEFAULT_FEATURE_FLAGS);
  });

  it('fails closed when FEATURE_FLAGS_PARAM is unset, without calling SSM', async () => {
    delete process.env.FEATURE_FLAGS_PARAM;
    expect(await getFeatureFlags()).toEqual(DEFAULT_FEATURE_FLAGS);
    expect(ssmMock.commandCalls(GetParameterCommand)).toHaveLength(0);
  });

  it('propagates a genuine unrelated SSM error', async () => {
    ssmMock.on(GetParameterCommand).rejects(new Error('throttled'));
    await expect(getFeatureFlags()).rejects.toThrow('throttled');
  });
});
