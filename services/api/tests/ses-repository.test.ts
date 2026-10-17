import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { sendPlainTextEmail } from '../src/repositories/ses-repository';

const sesMock = mockClient(SESv2Client);

describe('sendPlainTextEmail', () => {
  beforeEach(() => {
    sesMock.reset();
  });
  afterEach(() => {
    sesMock.reset();
  });

  it('sends a plain-text email with the exact configuration set name', async () => {
    sesMock.on(SendEmailCommand).resolves({ MessageId: 'ses_1' });
    await sendPlainTextEmail({
      to: 'candidate@example.test',
      from: 'no-reply@zoryvex.space',
      subject: 'Your sign-in code',
      text: 'Your code is 000000.',
      configurationSetName: 'zoryvex-space',
    });

    const call = sesMock.commandCalls(SendEmailCommand)[0];
    expect(call!.args[0].input).toEqual({
      FromEmailAddress: 'no-reply@zoryvex.space',
      Destination: { ToAddresses: ['candidate@example.test'] },
      Content: {
        Simple: {
          Subject: { Data: 'Your sign-in code' },
          Body: { Text: { Data: 'Your code is 000000.' } },
        },
      },
      ConfigurationSetName: 'zoryvex-space',
    });
  });

  it('omits ConfigurationSetName when not supplied, rather than sending an empty string', async () => {
    sesMock.on(SendEmailCommand).resolves({ MessageId: 'ses_2' });
    await sendPlainTextEmail({
      to: 'employer@example.test',
      from: 'no-reply@zoryvex.space',
      subject: 'Kit ready',
      text: 'Your kit is ready to download.',
    });

    const call = sesMock.commandCalls(SendEmailCommand)[0];
    expect(call!.args[0].input.ConfigurationSetName).toBeUndefined();
  });

  it('propagates an SES sandbox-mode rejection (unverified recipient) rather than swallowing it', async () => {
    sesMock
      .on(SendEmailCommand)
      .rejects(
        Object.assign(new Error('Email address is not verified.'), { name: 'MessageRejected' }),
      );
    await expect(
      sendPlainTextEmail({
        to: 'unverified@example.test',
        from: 'no-reply@zoryvex.space',
        subject: 'x',
        text: 'x',
      }),
    ).rejects.toThrow('Email address is not verified.');
  });

  it('never embeds the recipient/body outside the single SendEmailCommand call (no secondary side channel)', async () => {
    sesMock.on(SendEmailCommand).resolves({ MessageId: 'ses_3' });
    await sendPlainTextEmail({
      to: 'candidate@example.test',
      from: 'no-reply@zoryvex.space',
      subject: 'x',
      text: 'x',
    });
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(1);
  });
});
