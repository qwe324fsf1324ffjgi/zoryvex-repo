import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';

const ses = new SESv2Client({});

export async function sendPlainTextEmail(input: {
  to: string;
  from: string;
  subject: string;
  text: string;
  configurationSetName?: string | undefined;
}): Promise<void> {
  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: input.from,
      Destination: { ToAddresses: [input.to] },
      Content: {
        Simple: { Subject: { Data: input.subject }, Body: { Text: { Data: input.text } } },
      },
      ConfigurationSetName: input.configurationSetName,
    }),
  );
}
