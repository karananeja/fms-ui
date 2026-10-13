import {
  errorResponseSchema,
  meSchema,
  serverMessageSchema,
  type ClientMessage,
  type ServerMessage,
} from '@shared/contract/index.ts';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import type { z } from 'zod';
import { buildServer, type BuildOptions } from '../build-server.ts';

export const SEED_USERS = {
  superadmin: { email: 'superadmin@fms.local', password: 'Admin@123' },
  ops: { email: 'ops@fms.local', password: 'Ops@1234' },
  viewer: { email: 'viewer@fms.local', password: 'View@1234' },
} as const;

export interface ApiResult<T = unknown> {
  status: number;
  body: T;
  cookie?: string;
}

/** In-process mock server on a random port with a small fleet. Close it in `afterAll`. */
export async function startServer(options: BuildOptions = {}) {
  const app = buildServer({ vehicles: 2000, ...options });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  /**
   * Calls the REST API and validates every response against the contract: errors against
   * the error envelope, successes with a body against `schema` (required), 202/204 as empty.
   */
  async function api<S extends z.ZodType>(
    method: string,
    path: string,
    opts: { body?: unknown; cookie?: string; schema?: S } = {},
  ): Promise<ApiResult<z.infer<S>>> {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text();
    const json: unknown = text ? JSON.parse(text) : undefined;
    if (res.status >= 400) errorResponseSchema.parse(json);
    else if (res.status === 202 || res.status === 204) {
      if (text) throw new Error(`${method} ${path}: expected an empty body, got ${text}`);
    } else {
      if (!opts.schema) throw new Error(`${method} ${path}: no response schema given`);
      opts.schema.parse(json);
    }
    const sid = res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0]!)
      .find((c) => c.startsWith('fms_sid=') && c !== 'fms_sid=');
    return { status: res.status, body: json as z.infer<S>, cookie: sid };
  }

  async function login(user: { email: string; password: string }): Promise<string> {
    const res = await api('POST', '/api/auth/login', { body: user, schema: meSchema });
    if (res.status !== 200 || !res.cookie) throw new Error(`login failed: ${res.status}`);
    return res.cookie;
  }

  const ws = (opts: { cookie?: string; share?: string } = {}) =>
    LiveClient.connect(
      `ws://127.0.0.1:${port}/ws/live${opts.share ? `?share=${opts.share}` : ''}`,
      opts.cookie,
    );

  return { app, ctx: app.mock, base, api, login, ws, close: () => app.close() };
}

/** WS test client: buffers and validates every message; every wait is bounded. */
export class LiveClient {
  readonly messages: ServerMessage[] = [];
  readonly invalid: unknown[] = [];
  closeCode?: number;
  private listeners = new Set<() => void>();

  private constructor(readonly socket: WebSocket) {
    socket.on('message', (raw) => {
      const json: unknown = JSON.parse(raw.toString());
      const parsed = serverMessageSchema.safeParse(json);
      if (parsed.success) this.messages.push(parsed.data);
      else this.invalid.push({ json, issues: parsed.error.issues });
      this.notify();
    });
    socket.on('close', (code) => {
      this.closeCode = code;
      this.notify();
    });
  }

  static connect(url: string, cookie?: string, timeoutMs = 3000): Promise<LiveClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url, { headers: cookie ? { cookie } : {} });
      const client = new LiveClient(socket);
      const timer = setTimeout(() => reject(new Error('ws connect timeout')), timeoutMs);
      socket.once('open', () => {
        clearTimeout(timer);
        resolve(client);
      });
      socket.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private notify() {
    for (const l of this.listeners) l();
  }

  send(msg: ClientMessage): void {
    this.socket.send(JSON.stringify(msg));
  }

  private until<T>(check: () => T | undefined, timeoutMs: number, what: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const done = () => {
        const value = check();
        if (value === undefined) return false;
        clearTimeout(timer);
        this.listeners.delete(listener);
        resolve(value);
        return true;
      };
      const listener = () => void done();
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error(`timed out after ${timeoutMs} ms waiting for ${what}`));
      }, timeoutMs);
      this.listeners.add(listener);
      done();
    });
  }

  /** First buffered message (at or after index `from`) matching `pred`, waiting at most `timeoutMs`. */
  waitFor<T extends ServerMessage['type']>(
    type: T,
    pred: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true,
    timeoutMs = 3000,
    from = 0,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    return this.until(
      () =>
        this.messages
          .slice(from)
          .find(
            (m): m is Extract<ServerMessage, { type: T }> => m.type === type && pred(m as never),
          ),
      timeoutMs,
      `"${type}" message`,
    );
  }

  waitClose(timeoutMs = 3000): Promise<number> {
    return this.until(() => this.closeCode, timeoutMs, 'close');
  }

  /** Waits for the last chunk of the snapshot of subscription `id` and returns all its chunks. */
  async snapshot(id: string, timeoutMs = 5000) {
    const last = await this.waitFor(
      'snapshot',
      (m) => m.id === id && m.chunk === m.chunks - 1,
      timeoutMs,
    );
    const chunks = this.messages.filter(
      (m): m is Extract<ServerMessage, { type: 'snapshot' }> =>
        m.type === 'snapshot' && m.id === id,
    );
    return { chunks, fields: last.fields, rows: chunks.flatMap((c) => c.rows) };
  }

  close(): void {
    this.socket.terminate();
  }
}

/** Turns columnar rows into objects keyed by field name. */
export const toObjects = (fields: string[], rows: unknown[][]) =>
  rows.map((r) => Object.fromEntries(fields.map((f, i) => [f, r[i]])) as Record<string, unknown>);
