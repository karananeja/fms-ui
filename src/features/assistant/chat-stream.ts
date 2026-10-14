import {
  CHAT_ERROR_CODES,
  chatEventSchema,
  type ChatEvent,
  type ChatRequest,
} from '@shared/contract/assistant.ts';

export type ChatErrorCode = (typeof CHAT_ERROR_CODES)[number];

/** Streams one answer; resolves when the stream ends, rejects (AbortError) when aborted. */
export type ChatTransport = (
  req: ChatRequest,
  onEvent: (e: ChatEvent) => void,
  signal: AbortSignal,
) => Promise<void>;

/** The request never produced a stream: `status` 401 means the session ended. */
export class ChatHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ChatErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ChatHttpError';
  }
}

const isCode = (c: unknown): c is ChatErrorCode =>
  typeof c === 'string' && (CHAT_ERROR_CODES as readonly string[]).includes(c);

/**
 * Splits an SSE byte stream into events and parses each `data:` payload as a `ChatEvent`
 * (comments, unknown or malformed events are skipped). Exported for tests.
 */
export class SseParser {
  private buf = '';

  constructor(private readonly onEvent: (e: ChatEvent) => void) {}

  push(chunk: string): void {
    this.buf += chunk.replace(/\r\n?/g, '\n');
    let end: number;
    while ((end = this.buf.indexOf('\n\n')) >= 0) {
      const block = this.buf.slice(0, end);
      this.buf = this.buf.slice(end + 2);
      this.dispatch(block);
    }
  }

  /** The stream ended: a last event without its blank line still counts. */
  end(): void {
    if (this.buf.trim()) this.dispatch(this.buf);
    this.buf = '';
  }

  private dispatch(block: string): void {
    const data = block
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(l.startsWith('data: ') ? 6 : 5))
      .join('\n');
    if (!data) return;
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    const parsed = chatEventSchema.safeParse(json);
    if (parsed.success) this.onEvent(parsed.data);
  }
}

/** F17-R2: `POST /api/chat` with the session cookie, read as Server-Sent Events. */
export const httpChatTransport: ChatTransport = async (req, onEvent, signal) => {
  let res: Response;
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(req),
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new ChatHttpError(0, 'failed', "Couldn't reach the server");
  }
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: unknown; message?: string };
    } | null;
    const code = body?.error?.code;
    throw new ChatHttpError(
      res.status,
      isCode(code) ? code : res.status === 429 || res.status >= 500 ? 'busy' : 'failed',
      body?.error?.message ?? `HTTP ${res.status}`,
    );
  }
  const parser = new SseParser(onEvent);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(value);
  }
  parser.end();
};
