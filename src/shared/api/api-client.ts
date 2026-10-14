/** Typed REST error: `status` 0 means the request never got an HTTP response. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Network failure or a 5xx: the server could not answer the request. */
  get unreachable(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

export interface ApiRequest {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

/** A wrong password is not an expired session (F02-R3). */
const NO_EXPIRY_PATHS = new Set(['/api/auth/login']);

let onUnauthorized: (() => void) | null = null;

/** Registers the session's 401 hook (one at a time; `null` removes it). */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/**
 * `fetch` with the session cookie and JSON in/out. Non-2xx responses throw an `ApiError` with
 * the server's `{ error: { code, message, details } }`; a 401 also calls the session hook.
 */
export async function apiFetch<T = unknown>(path: string, req: ApiRequest = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: req.method ?? (req.body === undefined ? 'GET' : 'POST'),
      credentials: 'include',
      headers: req.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      signal: req.signal,
    });
  } catch (err) {
    if (req.signal?.aborted) throw err;
    throw new ApiError(0, 'network', "Couldn't reach the server");
  }
  if (res.status === 401 && !NO_EXPIRY_PATHS.has(path)) onUnauthorized?.();
  const text = res.status === 204 ? '' : await res.text().catch(() => '');
  const body: unknown = text ? safeJson(text) : undefined;
  if (!res.ok) {
    const e = (body as { error?: { code?: string; message?: string; details?: unknown } })?.error;
    throw new ApiError(
      res.status,
      e?.code ?? (res.status >= 500 ? 'internal' : 'http_error'),
      e?.message ?? res.statusText ?? `HTTP ${res.status}`,
      e?.details,
    );
  }
  return body as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
