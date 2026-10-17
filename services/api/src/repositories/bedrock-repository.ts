import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const bedrock = new BedrockRuntimeClient({});

export interface BedrockInvokeInput {
  system: string;
  userText: string;
  maxTokens: number;
}

/**
 * Amazon Nova ("Invoke API" request/response shape, docs.aws.amazon.com/
 * nova/latest/userguide/complete-request-schema.html and .../
 * complete-request-schema-response.html, verified live — not guessed, same
 * research discipline as the GuardDuty/Paystack schemas in earlier
 * slices). `temperature` is kept low and `topP` conservative: this call
 * summarizes evidence for a human reviewer, not creative generation.
 */
export async function invokeModelForExplanation(input: BedrockInvokeInput): Promise<string> {
  const modelId = process.env.BEDROCK_MODEL_ID;
  if (!modelId) throw new Error('BEDROCK_MODEL_ID environment variable is not set');

  const requestBody = {
    schemaVersion: 'messages-v1',
    system: [{ text: input.system }],
    messages: [{ role: 'user', content: [{ text: input.userText }] }],
    inferenceConfig: { maxTokens: input.maxTokens, temperature: 0.1, topP: 0.9 },
  };

  const result = await bedrock.send(
    new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(requestBody),
    }),
  );

  const decoded: unknown = JSON.parse(new TextDecoder().decode(result.body));
  const text = (decoded as { output?: { message?: { content?: Array<{ text?: unknown }> } } })
    ?.output?.message?.content?.[0]?.text;
  if (typeof text !== 'string') {
    throw new Error('Bedrock response did not contain assistant text in the expected shape');
  }
  return text;
}
