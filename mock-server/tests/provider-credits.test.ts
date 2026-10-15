// @vitest-environment node
import Anthropic from '@anthropic-ai/sdk';
import type { ChatEvent } from '@shared/contract/index.ts';
import { describe, expect, it } from 'vitest';
import { AnthropicProvider } from '../assistant/anthropic-provider.ts';
import { runChat, type RunOptions } from '../assistant/assistant-runner.ts';
import { OpenAiCompatibleProvider } from '../assistant/openai-provider.ts';
import { KeyCheckError, listModels } from '../assistant/provider-models.ts';
import { OUT_OF_CREDITS_MESSAGE, type ChatProvider } from '../assistant/provider.ts';

/** User report 2026-10-16: an xAI team out of credits showed "not set up correctly". */

const XAI_403 = {
  code: 'The caller does not have permission to execute the specified operation',
  error:
    'Your team abc has either used all available credits or reached its monthly spending limit. To continue making API requests, please purchase more credits or raise your spending limit.',
};
const OPENAI_429 = {
  error: {
    message: 'You exceeded your current quota, please check your plan and billing details.',
    type: 'insufficient_quota',
    code: 'insufficient_quota',
  },
};

const stub = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

const oa = (name: 'openai' | 'xai', status: number, body: unknown) =>
  new OpenAiCompatibleProvider({
    name,
    apiKey: 'k',
    baseURL: 'https://example.test/v1',
    model: 'm',
    maxRetries: 0,
    fetch: stub(status, body),
  });

async function errorOf(provider: ChatProvider) {
  const events: ChatEvent[] = [];
  const opts: RunOptions = {
    provider,
    host: {} as RunOptions['host'],
    context: { name: 'n', role: 'r', fleets: [], today: '2026-10-16' },
    turns: [{ role: 'user', content: 'q' }],
    emit: (e) => events.push(e),
    signal: new AbortController().signal,
    abortReason: () => undefined,
    log: () => {},
  };
  await runChat(opts);
  return events.find((e) => e.type === 'error');
}

describe('out of credits is reported as such', () => {
  it('xAI 403 and OpenAI 429 insufficient_quota → credits message; a plain 401 stays "not set up"', async () => {
    expect(await errorOf(oa('xai', 403, XAI_403))).toMatchObject({
      message: OUT_OF_CREDITS_MESSAGE,
    });
    expect(await errorOf(oa('openai', 429, OPENAI_429))).toMatchObject({
      message: OUT_OF_CREDITS_MESSAGE,
    });
    expect(await errorOf(oa('xai', 401, { error: 'Incorrect API key' }))).toMatchObject({
      message: 'The assistant is not set up correctly. Ask an administrator.',
    });
    expect(oa('openai', 429, {}).classify(new Error('x'))).toEqual({ kind: 'failed' });
  });

  it('Anthropic "credit balance is too low" → credits; 5xx stays busy', () => {
    const p = new AnthropicProvider(new Anthropic({ apiKey: 'k' }));
    const low = Anthropic.APIError.generate(
      400,
      {
        error: {
          type: 'invalid_request_error',
          message: 'Your credit balance is too low to access the Anthropic API.',
        },
      },
      undefined,
      new Headers(),
    );
    expect(p.classify(low)).toEqual({ kind: 'credits', status: 400 });
    expect(
      p.classify(
        Anthropic.APIError.generate(
          529,
          { error: { message: 'Overloaded' } },
          undefined,
          new Headers(),
        ),
      ).kind,
    ).toBe('busy');
  });

  it('F25 key check: an out-of-credits key is not called "rejected this key"; provider text is not passed on', async () => {
    const err = (await listModels('xai', 'xai-real', {
      fakeAvailable: false,
      fetch: stub(403, XAI_403),
    }).catch((e: unknown) => e)) as KeyCheckError;
    expect(err).toBeInstanceOf(KeyCheckError);
    expect(err.message).toBe(
      'xAI Grok accepted this key, but the account is out of credits or over its spending limit.',
    );
    await expect(
      listModels('xai', 'xai-real', {
        fakeAvailable: false,
        fetch: stub(403, { error: 'Forbidden' }),
      }),
    ).rejects.toThrow('xAI Grok rejected this key.');
  });
});
