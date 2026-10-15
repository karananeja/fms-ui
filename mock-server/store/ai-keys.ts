import type { AiKeySummary, AiProvider } from '@shared/contract/index.ts';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import {
  decryptSecret,
  encryptSecret,
  keyAad,
  maskKey,
  secretKey,
} from '../assistant/key-crypto.ts';
import type { Clock } from '../clock.ts';
import { atomic } from '../db/database.ts';
import { HttpError } from '../http-error.ts';

/** `org_settings` key of the server-key fallback switch (D-143). */
export const FALLBACK_SETTING = 'assistant.allowServerKeyFallback';
/** Default when never set: on, so the F21 server key keeps working until an admin turns it off. */
export const FALLBACK_DEFAULT = true;

export type AuditAction = 'ai_key.saved' | 'ai_key.removed' | 'ai_settings.updated';

export interface AuditEntry {
  seq: number;
  at: number;
  actorId: string;
  action: AuditAction;
  target: string;
  details: Record<string, unknown>;
}

interface StoredKey {
  provider: AiProvider;
  model: string;
  secret: string;
  masked: string;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

interface KeyRow {
  user_id: string;
  provider: AiProvider;
  model: string;
  secret: string;
  masked: string;
  active: number;
  created_at: number;
  updated_at: number;
}

const SQL = {
  upsertKey: `INSERT INTO user_ai_keys (user_id, provider, model, secret, masked, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT (user_id, provider) DO UPDATE SET model = excluded.model, secret = excluded.secret,
      masked = excluded.masked, active = 1, updated_at = excluded.updated_at`,
  deactivateOthers: 'UPDATE user_ai_keys SET active = 0 WHERE user_id = ? AND provider <> ?',
  activate: 'UPDATE user_ai_keys SET active = 1 WHERE user_id = ? AND provider = ?',
  deleteKey: 'DELETE FROM user_ai_keys WHERE user_id = ? AND provider = ?',
  upsertSetting: `INSERT INTO org_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by,
      updated_at = excluded.updated_at`,
  insertAudit: 'INSERT INTO audit_log (at, actor_id, action, target, details) VALUES (?, ?, ?, ?, ?)',
} as const;

/**
 * F25 user AI keys, org settings and the audit log: a write-through cache over `fms.db` like the
 * F22 stores (reads from memory, each mutation writes its rows inside `atomic()`). Plaintext keys
 * exist only transiently (`activeKey`, `storedKey`) and are never cached.
 */
export class AiKeys {
  private readonly keys = new Map<string, Map<AiProvider, StoredKey>>();
  private fallback = FALLBACK_DEFAULT;
  private readonly stmt: Record<keyof typeof SQL, StatementSync>;

  constructor(
    private readonly db: DatabaseSync,
    private readonly clock: Clock,
  ) {
    this.stmt = Object.fromEntries(
      Object.entries(SQL).map(([k, sql]) => [k, db.prepare(sql)]),
    ) as Record<keyof typeof SQL, StatementSync>;
  }

  hydrate(): void {
    this.keys.clear();
    for (const r of this.db
      .prepare('SELECT * FROM user_ai_keys ORDER BY updated_at')
      .all() as unknown as KeyRow[]) {
      this.userKeys(r.user_id).set(r.provider, {
        provider: r.provider,
        model: r.model,
        secret: r.secret,
        masked: r.masked,
        active: r.active === 1,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      });
    }
    const row = this.db
      .prepare('SELECT value FROM org_settings WHERE key = ?')
      .get(FALLBACK_SETTING) as { value: string } | undefined;
    this.fallback = row ? JSON.parse(row.value) === true : FALLBACK_DEFAULT;
  }

  private userKeys(userId: string): Map<AiProvider, StoredKey> {
    let m = this.keys.get(userId);
    if (!m) this.keys.set(userId, (m = new Map()));
    return m;
  }

  /** Masked summaries, newest first. */
  list(userId: string): AiKeySummary[] {
    const key = secretKey();
    return [...(this.keys.get(userId)?.values() ?? [])]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((k) => ({
        provider: k.provider,
        model: k.model,
        masked: k.masked,
        active: k.active,
        readable: decryptSecret(k.secret, keyAad(userId, k.provider), key) !== undefined,
        createdAt: k.createdAt,
        updatedAt: k.updatedAt,
      }));
  }

  /** The decrypted stored key of one provider, or `undefined` (none, or unreadable). */
  storedKey(userId: string, provider: AiProvider): string | undefined {
    const k = this.keys.get(userId)?.get(provider);
    return k && decryptSecret(k.secret, keyAad(userId, provider), secretKey());
  }

  has(userId: string, provider: AiProvider): boolean {
    return this.keys.get(userId)?.has(provider) ?? false;
  }

  /** The active key, decrypted; `undefined` when there is none or it can't be decrypted. */
  activeKey(userId: string): { provider: AiProvider; apiKey: string; model: string } | undefined {
    for (const k of this.keys.get(userId)?.values() ?? []) {
      if (!k.active) continue;
      const apiKey = decryptSecret(k.secret, keyAad(userId, k.provider), secretKey());
      return apiKey ? { provider: k.provider, apiKey, model: k.model } : undefined;
    }
    return undefined;
  }

  /**
   * Saves (encrypts) a key, or with `apiKey` undefined re-saves the stored one with `model`; the
   * saved key becomes the active one. `409 secret_missing` without a usable `FMS_SECRET_KEY`,
   * `404` when no key is given and none is stored.
   */
  save(
    userId: string,
    provider: AiProvider,
    input: { apiKey?: string; model: string },
    actorId: string,
  ): void {
    const key = secretKey();
    if (!key)
      throw new HttpError(
        409,
        'secret_missing',
        'The server has no FMS_SECRET_KEY, so API keys cannot be stored. Ask an administrator.',
      );
    const existing = this.keys.get(userId)?.get(provider);
    let secret: string;
    let masked: string;
    if (input.apiKey !== undefined) {
      secret = encryptSecret(input.apiKey, keyAad(userId, provider), key);
      masked = maskKey(input.apiKey);
    } else {
      if (!existing) throw new HttpError(404, 'not_found', 'No saved key for this provider');
      if (decryptSecret(existing.secret, keyAad(userId, provider), key) === undefined)
        throw new HttpError(409, 'conflict', 'The saved key cannot be read. Paste it again.');
      ({ secret, masked } = existing);
    }
    const now = this.clock.now();
    atomic(this.db, () => {
      this.stmt.upsertKey.run(userId, provider, input.model, secret, masked, now, now);
      this.stmt.deactivateOthers.run(userId, provider);
      this.audit(actorId, 'ai_key.saved', userId, {
        provider,
        model: input.model,
        replaced: existing !== undefined && input.apiKey !== undefined,
      });
    });
    const keys = this.userKeys(userId);
    for (const k of keys.values()) k.active = false;
    keys.set(provider, {
      provider,
      model: input.model,
      secret,
      masked,
      active: true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  /** Deletes a key; when it was active, the most recently updated remaining key becomes active. */
  remove(userId: string, provider: AiProvider, actorId: string): void {
    const keys = this.keys.get(userId);
    const removed = keys?.get(provider);
    if (!keys || !removed) throw new HttpError(404, 'not_found', 'No saved key for this provider');
    const next = removed.active
      ? [...keys.values()]
          .filter((k) => k.provider !== provider)
          .sort((a, b) => b.updatedAt - a.updatedAt)[0]
      : undefined;
    atomic(this.db, () => {
      this.stmt.deleteKey.run(userId, provider);
      if (next) this.stmt.activate.run(userId, next.provider);
      this.audit(actorId, 'ai_key.removed', userId, { provider });
    });
    keys.delete(provider);
    if (next) next.active = true;
  }

  get allowServerKeyFallback(): boolean {
    return this.fallback;
  }

  setAllowServerKeyFallback(allowed: boolean, actorId: string): void {
    atomic(this.db, () => {
      this.stmt.upsertSetting.run(FALLBACK_SETTING, JSON.stringify(allowed), actorId, this.clock.now());
      this.audit(actorId, 'ai_settings.updated', 'org', { allowServerKeyFallback: allowed });
    });
    this.fallback = allowed;
  }

  /** Appends an audit row; `details` must never hold key material. */
  audit(actorId: string, action: AuditAction, target: string, details: Record<string, unknown>) {
    this.stmt.insertAudit.run(this.clock.now(), actorId, action, target, JSON.stringify(details));
  }

  /** Newest first (tests and future admin views). */
  auditEntries(limit = 50): AuditEntry[] {
    return (
      this.db
        .prepare('SELECT * FROM audit_log ORDER BY seq DESC LIMIT ?')
        .all(limit) as unknown as {
        seq: number;
        at: number;
        actor_id: string;
        action: AuditAction;
        target: string;
        details: string;
      }[]
    ).map((r) => ({
      seq: r.seq,
      at: r.at,
      actorId: r.actor_id,
      action: r.action,
      target: r.target,
      details: JSON.parse(r.details) as Record<string, unknown>,
    }));
  }
}
