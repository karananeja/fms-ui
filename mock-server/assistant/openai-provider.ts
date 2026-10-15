import {
  runRunnableTool,
  type BetaRunnableTool,
} from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool';
import { buildTools, strictSafeSchema, toolDefinitions } from './assistant-tools.ts';
import {
  emptyUsage,
  messageText,
  ProviderHttpError,
  type ChatMessage,
  type ChatProvider,
  type ErrorClass,
  type ProviderResult,
  type ProviderTurn,
} from './provider.ts';
import { SYSTEM_PROMPT } from './system-prompt.ts';

/**
 * F21 (D-134): one OpenAI-compatible chat-completions adapter for `openai` and `xai`, written
 * with plain `fetch` + SSE parsing (no SDK). Same tools (the zod tools, converted to
 * `tools[].function` JSON schema), the same system prompt and the same step cap as the Anthropic
 * path. Each step streams one reply (`content` deltas → `onText`, `tool_calls` deltas
 * accumulated by index); requested tools run in parallel and their results go back as `tool`
 * messages. A failed tool's content starts with `Error: ` (there is no `is_error` flag).
 */

export interface OpenAiTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
  };
}

interface OaToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type OaMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OaToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

/** Prefix of a failed tool's result content. */
export const TOOL_ERROR_PREFIX = 'Error: ';

/**
 * True if a JSON schema meets OpenAI's strict-mode rules: every object lists all its properties
 * as required and sets `additionalProperties: false`.
 */
export function isStrictCompatible(schema: unknown): boolean {
  if (Array.isArray(schema)) return schema.every(isStrictCompatible);
  if (!schema || typeof schema !== 'object') return true;
  const s = schema as Record<string, unknown>;
  if (s.type === 'object' || s.properties) {
    const keys = Object.keys((s.properties as object | undefined) ?? {});
    const required = new Set((s.required as string[] | undefined) ?? []);
    if (s.additionalProperties !== false || keys.some((k) => !required.has(k))) return false;
  }
  return Object.values(s).every(isStrictCompatible);
}

/**
 * Anthropic tool definitions → OpenAI `tools`. `strict: true` only where `strict` is asked for
 * (OpenAI; xAI gets plain schemas) and the schema qualifies; strict schemas drop the bounds the
 * strict grammar may reject (zod still validates them when the tool runs).
 */
export function toOpenAiTools(tools: BetaRunnableTool[], strict: boolean): OpenAiTool[] {
  return (
    toolDefinitions(tools) as { name: string; description?: string; input_schema: object }[]
  ).map((t) => {
    const parameters = { ...(t.input_schema as Record<string, unknown>) };
    delete parameters.$schema;
    const useStrict = strict && isStrictCompatible(parameters);
    return {
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: useStrict
          ? (strictSafeSchema(parameters) as Record<string, unknown>)
          : parameters,
        ...(useStrict ? { strict: true } : {}),
      },
    };
  });
}

/** Transcript → chat-completions messages (system prompt first; text blocks joined). */
export function toOpenAiMessages(messages: ChatMessage[]): OaMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages.map((m): OaMessage => ({ role: m.role, content: messageText(m) })),
  ];
}

export interface OpenAiProviderOptions {
  name: 'openai' | 'xai';
  apiKey: string;
  /** API base URL without the trailing `/chat/completions`. */
  baseURL: string;
  model: string;
  /** Retries of a 429 / 5xx / network error before any byte streamed (0 in fake mode). */
  maxRetries?: number;
  fetch?: typeof fetch;
}

interface Chunk {
  choices?: {
    delta?: {
      content?: string | null;
      refusal?: string | null;
      tool_calls?: {
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    finish_reason?: string | null;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number } | null;
  } | null;
  error?: { message?: string };
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });

export class OpenAiCompatibleProvider implements ChatProvider {
  readonly name: 'openai' | 'xai';
  readonly model: string;
  private readonly opts: OpenAiProviderOptions;

  constructor(opts: OpenAiProviderOptions) {
    this.opts = opts;
    this.name = opts.name;
    this.model = opts.model;
  }

  async run(turn: ProviderTurn): Promise<ProviderResult> {
    const runnable = buildTools(turn.host);
    const byName = new Map(runnable.map((t) => [t.name, t]));
    const tools = toOpenAiTools(runnable, this.name === 'openai');
    const messages = toOpenAiMessages(turn.messages);
    const usage = emptyUsage();
    let iterations = 0;
    let stopReason = 'end_turn';

    while (iterations < turn.maxIterations) {
      const reply = await this.step(messages, tools, turn, usage, iterations);
      iterations++;
      if (reply.refused) return { stopReason: 'refusal', iterations, usage };
      if (!reply.calls.length) {
        stopReason = reply.finish === 'length' ? 'max_tokens' : 'end_turn';
        break;
      }
      messages.push({ role: 'assistant', content: reply.text || null, tool_calls: reply.calls });
      const results = await Promise.all(
        reply.calls.map((call) => this.runTool(byName.get(call.function.name), call, turn.signal)),
      );
      for (const [k, content] of results.entries())
        messages.push({ role: 'tool', tool_call_id: reply.calls[k]!.id, content });
      // The cap: the last reply still asked for tools (they ran, as on the Anthropic path).
      stopReason = 'tool_use';
    }
    return { stopReason, iterations, usage };
  }

  classify(err: unknown): ErrorClass {
    if (err instanceof ProviderHttpError) {
      if (err.status === 429 || err.status >= 500) return { kind: 'busy', status: err.status };
      if (err.status === 401 || err.status === 403) return { kind: 'auth', status: err.status };
      return { kind: 'failed', status: err.status };
    }
    // fetch rejects with a TypeError on network failures.
    if (err instanceof TypeError) return { kind: 'busy' };
    return { kind: 'failed' };
  }

  private async runTool(
    tool: BetaRunnableTool | undefined,
    call: OaToolCall,
    signal: AbortSignal,
  ): Promise<string> {
    if (!tool) return `${TOOL_ERROR_PREFIX}Tool '${call.function.name}' not found`;
    let input: unknown;
    try {
      input = call.function.arguments.trim() ? JSON.parse(call.function.arguments) : {};
    } catch {
      return `${TOOL_ERROR_PREFIX}The tool arguments are not valid JSON.`;
    }
    const toolUse = { type: 'tool_use' as const, id: call.id, name: call.function.name, input };
    const out = await runRunnableTool(tool, input, { toolUse, toolUseBlock: toolUse, signal });
    const content =
      typeof out.content === 'string'
        ? out.content
        : out.content.map((b) => ('text' in b ? b.text : '')).join('');
    if (!out.isError) return content;
    return content.startsWith(TOOL_ERROR_PREFIX) ? content : `${TOOL_ERROR_PREFIX}${content}`;
  }

  /** POST with retries on 429 / 5xx / network errors (before streaming starts). */
  private async request(body: unknown, signal: AbortSignal): Promise<Response> {
    const doFetch = this.opts.fetch ?? fetch;
    const url = `${this.opts.baseURL.replace(/\/+$/, '')}/chat/completions`;
    const retries = this.opts.maxRetries ?? 2;
    for (let attempt = 0; ; attempt++) {
      let res: Response | undefined;
      let error: unknown;
      try {
        res = await doFetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'text/event-stream',
            authorization: `Bearer ${this.opts.apiKey}`,
          },
          body: JSON.stringify(body),
          signal,
        });
      } catch (err) {
        if (signal.aborted) throw err;
        error = err;
      }
      if (res?.ok) return res;
      const retryable = !res || res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= retries) {
        if (!res) throw error;
        const text = await res.text().catch(() => '');
        let message = text.slice(0, 300);
        try {
          message =
            (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? message;
        } catch {
          // not JSON
        }
        throw new ProviderHttpError(res.status, `${this.name} API ${res.status}: ${message}`);
      }
      await res?.body?.cancel().catch(() => {});
      const after = Number(res?.headers.get('retry-after'));
      await sleep(
        Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 5000) : 500 * 2 ** attempt,
        signal,
      );
    }
  }

  /** One streamed reply. */
  private async step(
    messages: OaMessage[],
    tools: OpenAiTool[],
    turn: ProviderTurn,
    usage: ReturnType<typeof emptyUsage>,
    iteration: number,
  ) {
    const res = await this.request(
      {
        model: this.model,
        messages,
        tools,
        tool_choice: 'auto',
        stream: true,
        ...(this.name === 'openai' ? { stream_options: { include_usage: true } } : {}),
      },
      turn.signal,
    );
    let text = '';
    let refused = false;
    let finish: string | undefined;
    const calls: OaToolCall[] = [];

    const onChunk = (chunk: Chunk) => {
      if (chunk.error) throw new ProviderHttpError(500, chunk.error.message ?? 'stream error');
      if (chunk.usage) {
        const cached = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
        usage.inputTokens += Math.max(0, (chunk.usage.prompt_tokens ?? 0) - cached);
        usage.outputTokens += chunk.usage.completion_tokens ?? 0;
        usage.cacheReadInputTokens += cached;
      }
      for (const choice of chunk.choices ?? []) {
        const delta = choice.delta;
        if (delta?.content) {
          text += delta.content;
          turn.onText(delta.content);
        }
        if (delta?.refusal) refused = true;
        for (const tc of delta?.tool_calls ?? []) {
          const k = tc.index ?? calls.length;
          const call = (calls[k] ??= {
            id: '',
            type: 'function',
            function: { name: '', arguments: '' },
          });
          if (tc.id) call.id = tc.id;
          if (tc.function?.name) call.function.name += tc.function.name;
          if (tc.function?.arguments) call.function.arguments += tc.function.arguments;
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }
    };

    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    let data: string[] = [];
    let done = false;
    const flush = () => {
      const payload = data.join('\n').trim();
      data = [];
      if (!payload) return;
      if (payload === '[DONE]') {
        done = true;
        return;
      }
      onChunk(JSON.parse(payload) as Chunk);
    };
    while (!done) {
      const { value, done: ended } = await reader.read();
      if (ended) break;
      buf += value;
      let nl: number;
      while (!done && (nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (line === '') flush();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
    }
    if (!done) flush();
    await reader.cancel().catch(() => {});

    const toolCalls = calls
      .filter((c) => c.function.name)
      .map((c, n) => (c.id ? c : { ...c, id: `call_${iteration}_${n}` }));
    return {
      text,
      calls: toolCalls,
      refused: refused || finish === 'content_filter',
      finish,
    };
  }
}
