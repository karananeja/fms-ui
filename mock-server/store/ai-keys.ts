import {
  AI_PROVIDERS,
  MAX_AVAILABLE_MODELS,
  MAX_ENABLED_MODELS,
  type AiKeySummary,
  type AiModelChoice,
  type AiProvider,
} from '@shared/contract/index.ts';
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

export type AuditAction =
  | 'ai_key.saved'
  | 'ai_key.removed'
  | 'ai_key.models_updated'
  | 'ai_settings.updated';

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
  /** F31: the last model picked for this provider ('' when none yet). */
  model: string;
  secret: string;
  masked: string;
  /** F31: the chosen key (its `model` answers the chat), at most one per user. */
  active: boolean;
  available: string[];
  enabled: string[];
  fetchedAt: number | null;
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
  available_models: string;
  enabled_models: string;
  models_fetched_at: number | null;
  created_at: number;
  updated_at: number;
}

/** The user's model for chat turns, decrypted (transient, never cached). */
export interface UserModel {
  provider: AiProvider;
  apiKey: string;
  model: string;
}

const SQL = {
  upsertKey: `INSERT INTO user_ai_keys (user_id, provider, model, secret, masked, active,
      available_models, enabled_models, models_fetched_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, provider) DO UPDATE SET model = excluded.model, secret = excluded.secret,
      masked = excluded.masked, active = excluded.active, available_models = excluded.available_models,
      enabled_models = excluded.enabled_models, models_fetched_at = excluded.models_fetched_at,
      updated_at = excluded.updated_at`,
  setModels:
    'UPDATE user_ai_keys SET available_models = ?, enabled_models = ?, models_fetched_at = ?, updated_at = ? WHERE user_id = ? AND provider = ?',
  setChoice: 'UPDATE user_ai_keys SET active = (provider = ?), model = CASE WHEN provider = ? THEN ? ELSE model END WHERE user_id = ?',
  clearChoice: 'UPDATE user_ai_keys SET active = 0 WHERE user_id = ?',
  deleteKey: 'DELETE FROM user_ai_keys WHERE user_id = ? AND provider = ?',
  upsertPref: `INSERT INTO user_ai_prefs (user_id, use_server, updated_at) VALUES (?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET use_server = excluded.use_server, updated_at = excluded.updated_at`,
  upsertSetting: `INSERT INTO org_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by,
      updated_at = excluded.updated_at`,
  insertAudit: 'INSERT INTO audit_log (at, actor_id, action, target, details) VALUES (?, ?, ?, ?, ?)',
} as const;

const providerOrder = (p: AiProvider) => AI_PROVIDERS.indexOf(p);

/**
 * F25 user AI keys (+ F31 enabled models and the chat choice), org settings and the audit log: a
 * write-through cache over `fms.db` like the F22 stores (reads from memory, each mutation writes
 * its rows inside `atomic()`). Plaintext keys exist only transiently and are never cached.
 */
export class AiKeys {
  private readonly keys = new Map<string, Map<AiProvider, StoredKey>>();
  /** F31: users who picked the default assistant (server key) in the chat picker. */
  private readonly useServer = new Set<string>();
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
    this.useServer.clear();
    for (const r of this.db
      .prepare('SELECT * FROM user_ai_keys ORDER BY updated_at')
      .all() as unknown as KeyRow[]) {
      this.userKeys(r.user_id).set(r.provider, {
        provider: r.provider,
        model: r.model,
        secret: r.secret,
        masked: r.masked,
        active: r.active === 1,
        available: JSON.parse(r.available_models) as string[],
        enabled: JSON.parse(r.enabled_models) as string[],
        fetchedAt: r.models_fetched_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      });
    }
    for (const r of this.db
      .prepare('SELECT user_id FROM user_ai_prefs WHERE use_server = 1')
      .all() as { user_id: string }[])
      this.useServer.add(r.user_id);
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

  private decrypt(userId: string, k: StoredKey, key = secretKey()): string | undefined {
    return decryptSecret(k.secret, keyAad(userId, k.provider), key);
  }

  /** Masked summaries, newest first. */
  list(userId: string): AiKeySummary[] {
    const key = secretKey();
    return [...(this.keys.get(userId)?.values() ?? [])]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((k) => ({
        provider: k.provider,
        masked: k.masked,
        readable: this.decrypt(userId, k, key) !== undefined,
        availableModels: [...k.available],
        enabledModels: [...k.enabled],
        modelsFetchedAt: k.fetchedAt,
        createdAt: k.createdAt,
        updatedAt: k.updatedAt,
      }));
  }

  /** The decrypted stored key of one provider, or `undefined` (none, or unreadable). */
  storedKey(userId: string, provider: AiProvider): string | undefined {
    const k = this.keys.get(userId)?.get(provider);
    return k && this.decrypt(userId, k);
  }

  has(userId: string, provider: AiProvider): boolean {
    return this.keys.get(userId)?.has(provider) ?? false;
  }

  /** F31: whether the user has any key at all (for the `no_models_enabled` reason). */
  hasKeys(userId: string): boolean {
    return (this.keys.get(userId)?.size ?? 0) > 0;
  }

  /** F31: the enabled models of the user's readable keys, in provider order (chat picker). */
  options(userId: string): AiModelChoice[] {
    const key = secretKey();
    return [...(this.keys.get(userId)?.values() ?? [])]
      .filter((k) => this.decrypt(userId, k, key) !== undefined)
      .sort((a, b) => providerOrder(a.provider) - providerOrder(b.provider))
      .flatMap((k) => k.enabled.map((model) => ({ provider: k.provider, model })));
  }

  /** F31: the user picked the default assistant (server key) in the chat picker. */
  prefersServer(userId: string): boolean {
    return this.useServer.has(userId);
  }

  /**
   * F31 (D-171): the model the user's chat turns use: the chosen key's model while it is enabled
   * and readable, else the first enabled model of the newest readable key; `undefined` if none.
   */
  userModel(userId: string): UserModel | undefined {
    const pick = this.validChoice(userId) ?? this.fallbackChoice(userId);
    if (!pick) return undefined;
    const apiKey = this.storedKey(userId, pick.provider);
    return apiKey ? { ...pick, apiKey } : undefined;
  }

  private validChoice(userId: string): AiModelChoice | undefined {
    for (const k of this.keys.get(userId)?.values() ?? [])
      if (k.active && k.enabled.includes(k.model) && this.decrypt(userId, k) !== undefined)
        return { provider: k.provider, model: k.model };
    return undefined;
  }

  /** The chosen key's next enabled model, else the newest readable key with enabled models. */
  private fallbackChoice(userId: string): AiModelChoice | undefined {
    const keys = [...(this.keys.get(userId)?.values() ?? [])]
      .filter((k) => k.enabled.length > 0 && this.decrypt(userId, k) !== undefined)
      .sort((a, b) => Number(b.active) - Number(a.active) || b.updatedAt - a.updatedAt);
    const k = keys[0];
    return k && { provider: k.provider, model: k.enabled[0]! };
  }

  /** Keeps the stored choice valid after the models or keys change (inside `atomic()`). */
  private repairChoice(userId: string): void {
    if (this.validChoice(userId)) return;
    const next = this.fallbackChoice(userId);
    if (next) this.writeChoice(userId, next);
    else {
      this.stmt.clearChoice.run(userId);
      for (const k of this.keys.get(userId)?.values() ?? []) k.active = false;
    }
  }

  private writeChoice(userId: string, choice: AiModelChoice): void {
    this.stmt.setChoice.run(choice.provider, choice.provider, choice.model, userId);
    for (const k of this.keys.get(userId)?.values() ?? []) {
      k.active = k.provider === choice.provider;
      if (k.active) k.model = choice.model;
    }
  }

  private writePref(userId: string, useServer: boolean): void {
    this.stmt.upsertPref.run(userId, useServer ? 1 : 0, this.clock.now());
    if (useServer) this.useServer.add(userId);
    else this.useServer.delete(userId);
  }

  /**
   * F31: saves (encrypts) a key with the model list loaded for it (`models` undefined when it
   * couldn't be loaded: the previous list, if any, is kept). A replaced key keeps the enabled
   * models that are still available. `409 secret_missing` without a usable `FMS_SECRET_KEY`.
   */
  save(
    userId: string,
    provider: AiProvider,
    input: { apiKey: string; models?: string[] },
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
    const secret = encryptSecret(input.apiKey, keyAad(userId, provider), key);
    const masked = maskKey(input.apiKey);
    const now = this.clock.now();
    const available = input.models
      ? input.models.slice(0, MAX_AVAILABLE_MODELS)
      : (existing?.available ?? []);
    const enabled = (existing?.enabled ?? []).filter((m) => available.includes(m));
    const fetchedAt = input.models ? now : (existing?.fetchedAt ?? null);
    const stored: StoredKey = {
      provider,
      model: existing?.model ?? '',
      secret,
      masked,
      active: existing?.active ?? false,
      available,
      enabled,
      fetchedAt,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    atomic(this.db, () => {
      this.stmt.upsertKey.run(
        userId,
        provider,
        stored.model,
        secret,
        masked,
        stored.active ? 1 : 0,
        JSON.stringify(available),
        JSON.stringify(enabled),
        fetchedAt,
        stored.createdAt,
        now,
      );
      this.userKeys(userId).set(provider, stored);
      this.repairChoice(userId);
      this.audit(actorId, 'ai_key.saved', userId, {
        provider,
        models: available.length,
        replaced: existing !== undefined,
      });
    });
  }

  /** F31: a fresh model list for a stored key; enabled models that are gone are disabled. */
  refreshModels(userId: string, provider: AiProvider, models: string[]): void {
    const k = this.keys.get(userId)?.get(provider);
    if (!k) throw new HttpError(404, 'not_found', 'No saved key for this provider');
    const available = models.slice(0, MAX_AVAILABLE_MODELS);
    this.writeModels(userId, k, available, k.enabled.filter((m) => available.includes(m)), true);
  }

  /**
   * F31: the enabled models of one key (each must be available, ≤ 20). With no current choice,
   * the first enabled model becomes the choice; disabling the chosen model moves the choice.
   */
  setEnabled(userId: string, provider: AiProvider, enabled: string[], actorId: string): void {
    const k = this.keys.get(userId)?.get(provider);
    if (!k) throw new HttpError(404, 'not_found', 'No saved key for this provider');
    if (this.decrypt(userId, k) === undefined)
      throw new HttpError(409, 'conflict', 'The saved key cannot be read. Paste it again.');
    const ids = [...new Set(enabled)];
    if (ids.length > MAX_ENABLED_MODELS)
      throw new HttpError(422, 'validation', `Up to ${MAX_ENABLED_MODELS} models`);
    const unknown = ids.filter((m) => !k.available.includes(m));
    if (unknown.length)
      throw new HttpError(422, 'validation', `Not available for this key: ${unknown.join(', ')}`);
    atomic(this.db, () => {
      this.writeModels(userId, k, k.available, ids, false);
      this.audit(actorId, 'ai_key.models_updated', userId, { provider, enabled: ids });
    });
  }

  private writeModels(
    userId: string,
    k: StoredKey,
    available: string[],
    enabled: string[],
    fetched: boolean,
  ): void {
    const now = this.clock.now();
    atomic(this.db, () => {
      const fetchedAt = fetched ? now : k.fetchedAt;
      this.stmt.setModels.run(
        JSON.stringify(available),
        JSON.stringify(enabled),
        fetchedAt,
        now,
        userId,
        k.provider,
      );
      Object.assign(k, { available, enabled, fetchedAt, updatedAt: now });
      this.repairChoice(userId);
    });
  }

  /**
   * F31: the chat picker's choice. A model must be enabled on a readable key (422
   * `model_not_enabled`); `server` is checked by the caller against the fallback switch.
   */
  choose(userId: string, choice: AiModelChoice | 'server'): void {
    if (choice === 'server') {
      atomic(this.db, () => this.writePref(userId, true));
      return;
    }
    const k = this.keys.get(userId)?.get(choice.provider);
    if (!k || !k.enabled.includes(choice.model) || this.decrypt(userId, k) === undefined)
      throw new HttpError(422, 'model_not_enabled', `${choice.model} isn't enabled. Enable it in Settings.`);
    atomic(this.db, () => {
      this.writeChoice(userId, choice);
      if (this.useServer.has(userId)) this.writePref(userId, false);
    });
  }

  /** Deletes a key; the choice moves to another enabled model (D-171). */
  remove(userId: string, provider: AiProvider, actorId: string): void {
    const keys = this.keys.get(userId);
    if (!keys?.has(provider)) throw new HttpError(404, 'not_found', 'No saved key for this provider');
    atomic(this.db, () => {
      this.stmt.deleteKey.run(userId, provider);
      keys.delete(provider);
      this.repairChoice(userId);
      this.audit(actorId, 'ai_key.removed', userId, { provider });
    });
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
