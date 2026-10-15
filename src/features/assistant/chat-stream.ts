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

/**
 * F23: the stream broke after it started (network drop, provider cut, proxy timeout). The
 * stores mark the reply "Interrupted", keep the partial text and offer Retry.
 */
export class ChatStreamCutError extends Error {
  constructor(message = 'The connection dropped') {
    super(message);
    this.name = 'ChatStreamCutError';
  }
}

/** F23: a failure the stores show as "Interrupted" rather than an error. */
export const isInterruption = (err: unknown) =>
  err instanceof ChatStreamCutError || (err instanceof ChatHttpError && err.status === 0);

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

/** User-facing text for pre-stream statuses that have their own copy. */
const STATUS_TEXT: Partial<Record<ChatErrorCode, string>> = {
  chat_busy: 'Another reply is in progress on this dashboard',
};

/**
 * `POST url` with a JSON body and the session cookie, read as Server-Sent Events (one
 * `ChatEvent` per `data:` line). Pre-stream failures throw `ChatHttpError`; an abort rejects
 * with the fetch `AbortError`. Shared by the F17 global chat and the F19 dashboard chat.
 */
export async function streamSse(
  url: string,
  body: unknown,
  onEvent: (e: ChatEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new ChatHttpError(0, 'failed', "Couldn't reach the server");
  }
  if (!res.ok || !res.body) {
    const json = (await res.json().catch(() => null)) as {
      error?: { code?: unknown; message?: string };
    } | null;
    const raw = json?.error?.code;
    const code = isCode(raw) ? raw : res.status === 429 || res.status >= 500 ? 'busy' : 'failed';
    throw new ChatHttpError(
      res.status,
      code,
      // F27 (D-154): `chat_busy` names who is asking ("Priya is asking the assistant…").
      (code === 'chat_busy' ? json?.error?.message : undefined) ??
        STATUS_TEXT[code] ??
        json?.error?.message ??
        `HTTP ${res.status}`,
    );
  }
  // F23: heartbeat comments (`: ping`) carry no `data:` line and are skipped by the parser.
  const parser = new SseParser(onEvent);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    let chunk: ReadableStreamReadResult<string>;
    try {
      chunk = await reader.read();
    } catch (err) {
      if (signal.aborted) throw err;
      throw new ChatStreamCutError();
    }
    if (chunk.done) break;
    parser.push(chunk.value);
  }
  parser.end();
}

/** F17-R2: `POST /api/chat` with the session cookie, read as Server-Sent Events. */
export const httpChatTransport: ChatTransport = (req, onEvent, signal) =>
  streamSse('/api/chat', req, onEvent, signal);
