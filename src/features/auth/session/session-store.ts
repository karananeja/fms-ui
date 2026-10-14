import type { Me } from '@shared/contract/index.ts';
import { apiFetch, ApiError, setUnauthorizedHandler } from '@/shared/api/api-client';

export type SessionStatus = 'unknown' | 'authenticated' | 'anonymous';
/** One-shot message for the sign-in screen (F02-R3, R9). */
export type SessionNotice = 'expired' | 'password-updated';

export interface SessionState {
  status: SessionStatus;
  me: Me | null;
  notice: SessionNotice | null;
}

export interface SessionApi {
  me(): Promise<Me>;
  login(email: string, password: string): Promise<Me>;
  logout(): Promise<void>;
  acceptInvite(token: string, name: string, password: string): Promise<Me>;
}

export const httpSessionApi: SessionApi = {
  me: () => apiFetch<Me>('/api/auth/me'),
  login: (email, password) => apiFetch<Me>('/api/auth/login', { body: { email, password } }),
  logout: () => apiFetch<void>('/api/auth/logout', { method: 'POST' }),
  acceptInvite: (token, name, password) =>
    apiFetch<Me>('/api/auth/accept-invite', { body: { token, name, password } }),
};

const initial: SessionState = { status: 'unknown', me: null, notice: null };

/** F02-R1: the only owner of "who is signed in". */
export class SessionStore {
  private state: SessionState = initial;
  private readonly listeners = new Set<() => void>();
  private loading: Promise<void> | null = null;
  private signingOut = false;

  constructor(private readonly api: SessionApi = httpSessionApi) {}

  /** `GET /api/auth/me` once per app start; later calls return the same promise. */
  load(): Promise<void> {
    this.loading ??= this.api.me().then(
      (me) => {
        // A login that finished meanwhile wins over the start-up probe.
        if (this.state.status === 'unknown')
          this.set({ status: 'authenticated', me, notice: null });
      },
      (err: unknown) => {
        if (this.state.status === 'unknown') {
          // 401 = signed out; anything else (offline, 5xx) also lands on the sign-in screen.
          if (!(err instanceof ApiError)) console.error(err);
          this.set({ ...this.state, status: 'anonymous', me: null });
        }
      },
    );
    return this.loading;
  }

  async login(email: string, password: string): Promise<Me> {
    const me = await this.api.login(email, password);
    this.set({ status: 'authenticated', me, notice: null });
    return me;
  }

  /** The server signs the new user in (F02-R10). */
  async acceptInvite(token: string, name: string, password: string): Promise<Me> {
    const me = await this.api.acceptInvite(token, name, password);
    this.set({ status: 'authenticated', me, notice: null });
    return me;
  }

  /** F02-R11: clears locally even when the request fails. */
  async logout(): Promise<void> {
    this.signingOut = true;
    try {
      await this.api.logout();
    } catch {
      // Already signed out on the server, or unreachable: the local session ends either way.
    } finally {
      this.signingOut = false;
      this.set({ status: 'anonymous', me: null, notice: null });
    }
  }

  /** Any 401 (F02-R3). Only an active session can expire; probes and sign-out are ignored. */
  expire = (): void => {
    if (this.signingOut || this.state.status !== 'authenticated') return;
    this.set({ status: 'anonymous', me: null, notice: 'expired' });
  };

  /** Shown once by the sign-in screen after a password reset (F02-R9). */
  setNotice(notice: SessionNotice | null): void {
    if (notice !== this.state.notice) this.set({ ...this.state, notice });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SessionState => this.state;

  private set(state: SessionState): void {
    this.state = state;
    for (const l of this.listeners) l();
  }
}

export const sessionStore = new SessionStore();
setUnauthorizedHandler(sessionStore.expire);
