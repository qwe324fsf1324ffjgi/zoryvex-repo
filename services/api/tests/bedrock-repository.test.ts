import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { invokeModelForExplanation } from '../src/repositories/bedrock-repository';

const bedrockMock = mockClient(BedrockRuntimeClient);

// Real InvokeModelCommandOutput.body is an IUint8ArrayBlobAdapter (a
// Uint8Array with extra transform* helpers this repository never calls —
// it only ever runs TextDecoder().decode() on it, which any Uint8Array
// satisfies at runtime). Adding a no-op transformToString here only
// satisfies aws-sdk-client-mock's stricter compile-time type.
function encodeBody(value: unknown): Uint8Array & { transformToString(): string } {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return Object.assign(bytes, {
    transformToString: () => new TextDecoder().decode(bytes),
  });
}

describe('invokeModelForExplanation', () => {
  beforeEach(() => {
    bedrockMock.reset();
    process.env.BEDROCK_MODEL_ID = 'eu.amazon.nova-micro-v1:0';
  });
  afterEach(() => {
    delete process.env.BEDROCK_MODEL_ID;
  });

  it('sends the Nova Invoke-API request shape and returns the assistant text', async () => {
    bedrockMock.on(InvokeModelCommand).resolves({
      body: encodeBody({
        output: { message: { role: 'assistant', content: [{ text: '{"ok":true}' }] } },
        stopReason: 'end_turn',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      }),
    });

    const result = await invokeModelForExplanation({
      system: 'be terse',
      userText: 'explain this',
      maxTokens: 300,
    });

    expect(result).toBe('{"ok":true}');
    const call = bedrockMock.commandCalls(InvokeModelCommand)[0];
    expect(call!.args[0].input.modelId).toBe('eu.amazon.nova-micro-v1:0');
    const sentBody = JSON.parse(call!.args[0].input.body as string);
    expect(sentBody).toMatchObject({
      schemaVersion: 'messages-v1',
      system: [{ text: 'be terse' }],
      messages: [{ role: 'user', content: [{ text: 'explain this' }] }],
      inferenceConfig: { maxTokens: 300 },
    });
  });

  it('throws when BEDROCK_MODEL_ID is not set', async () => {
    delete process.env.BEDROCK_MODEL_ID;
    await expect(
      invokeModelForExplanation({ system: 's', userText: 'u', maxTokens: 10 }),
    ).rejects.toThrow('BEDROCK_MODEL_ID');
  });

  it('throws when the response body has no assistant text in the expected shape', async () => {
    bedrockMock.on(InvokeModelCommand).resolves({
      body: encodeBody({ output: { message: { content: [] } } }),
    });
    await expect(
      invokeModelForExplanation({ system: 's', userText: 'u', maxTokens: 10 }),
    ).rejects.toThrow('expected shape');
  });

  it('propagates a throttling error from the SDK call', async () => {
    const error = Object.assign(new Error('too many requests'), { name: 'ThrottlingException' });
    bedrockMock.on(InvokeModelCommand).rejects(error);
    await expect(
      invokeModelForExplanation({ system: 's', userText: 'u', maxTokens: 10 }),
    ).rejects.toThrow('too many requests');
  });
});
