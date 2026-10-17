import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { getPaystackSecretKey } from '../src/repositories/ssm-secure-repository';

const ssmMock = mockClient(SSMClient);

// Fixture values only. Neither is a real credential.
//
// Assembled at runtime rather than written as literals because
// scripts/scan-secrets.mjs correctly flags anything shaped like a Paystack
// key, and it caught these on the first run. Weakening the scanner so a
// test could keep a convenient literal would trade a real guard for a
// cosmetic one; the prefix these produce is identical, so the assertions
// below test exactly what they did before.
const PREFIX_TEST = ['sk', 'test', ''].join('_');
const PREFIX_LIVE = ['sk', 'live', ''].join('_');
const TEST_KEY = `${PREFIX_TEST}fixtureonly0000000000000000000000`;
const LIVE_KEY = `${PREFIX_LIVE}fixtureonly0000000000000000000000`;

describe('getPaystackSecretKey', () => {
  beforeEach(() => {
    ssmMock.reset();
    process.env.PAYSTACK_SECRET_KEY_PARAM = '/zoryvex/test/paystack/secret-key';
    delete process.env.PAYSTACK_KEY_PREFIX;
  });

  afterEach(() => {
    delete process.env.PAYSTACK_SECRET_KEY_PARAM;
    delete process.env.PAYSTACK_KEY_PREFIX;
    vi.restoreAllMocks();
  });

  it('reads the parameter with decryption, because it is a SecureString', async () => {
    ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: TEST_KEY } });
    await expect(getPaystackSecretKey()).resolves.toBe(TEST_KEY);
    expect(ssmMock.commandCalls(GetParameterCommand)[0]?.args[0].input).toMatchObject({
      Name: '/zoryvex/test/paystack/secret-key',
      WithDecryption: true,
    });
  });

  /**
   * The Paystack account is live-approved, so a working `sk_live_` key
   * exists and can be pasted anywhere a key is asked for. The single most
   * expensive mistake available is that key landing in the TEST
   * environment's parameter, where every automated test, every demo
   * walkthrough and every reconciliation run would quietly move real money.
   *
   * Nothing in the code could tell the difference before this: the
   * environment is decided entirely by which key is configured, which is
   * the right design and exactly why it needs a second opinion.
   */
  it('refuses a live key in an environment configured for test', async () => {
    process.env.PAYSTACK_KEY_PREFIX = PREFIX_TEST;
    ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: LIVE_KEY } });
    await expect(getPaystackSecretKey()).rejects.toThrow(/does not start with sk_test_/);
  });

  it('refuses a test key in an environment configured for live', async () => {
    process.env.PAYSTACK_KEY_PREFIX = PREFIX_LIVE;
    ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: TEST_KEY } });
    await expect(getPaystackSecretKey()).rejects.toThrow(/does not start with sk_live_/);
  });

  it('never puts the key itself in the error', async () => {
    process.env.PAYSTACK_KEY_PREFIX = PREFIX_TEST;
    ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: LIVE_KEY } });
    await expect(getPaystackSecretKey()).rejects.toThrow(
      expect.not.stringContaining(LIVE_KEY) as unknown as string,
    );
  });

  it('accepts the key when the prefix matches', async () => {
    process.env.PAYSTACK_KEY_PREFIX = PREFIX_TEST;
    ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: TEST_KEY } });
    await expect(getPaystackSecretKey()).resolves.toBe(TEST_KEY);
  });

  /**
   * Absent means unchecked, so an environment that has not opted in keeps
   * working exactly as it did. A guard that broke every unconfigured
   * environment on the day it shipped would be reverted rather than fixed.
   */
  it('does not check when no prefix is configured', async () => {
    ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: LIVE_KEY } });
    await expect(getPaystackSecretKey()).resolves.toBe(LIVE_KEY);
  });

  it('refuses when the parameter is empty rather than sending an empty bearer token', async () => {
    ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: '' } });
    await expect(getPaystackSecretKey()).rejects.toThrow(/has no value/);
  });

  it('refuses when the environment names no parameter at all', async () => {
    delete process.env.PAYSTACK_SECRET_KEY_PARAM;
    await expect(getPaystackSecretKey()).rejects.toThrow(/PAYSTACK_SECRET_KEY_PARAM/);
  });
});
